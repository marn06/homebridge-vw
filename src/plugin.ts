import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge"

import timeoutPromise from "./timeoutPromise"
import { join } from 'path'
import { spawn } from 'child_process'

let hap: HAP

export = (api: API) => {
  hap = api.hap
  api.registerAccessory("homebridge-vw", "WeConnect", WeConnect)
}

class WeConnect implements AccessoryPlugin {
  private readonly log: Logging
  private readonly config: AccessoryConfig
  private readonly name: string = ""
  private readonly username: string = ""
  private readonly password: string = ""
  private readonly spin: string = ""
  private readonly vin: string = ""

  private lastRequest: Date | undefined = undefined
  private climatisationOn = false
  private locked = false

  private readonly climatisationService: Service
  private readonly lockService: Service
  private readonly informationService: Service
  constructor(log: Logging, config: AccessoryConfig, api: API) {

    this.log = log
    this.name = config.name
    this.config = config

    this.username = config['username']
    this.password = config['password']
    this.spin = config['spin']
    this.vin = config['vin']

    this.lastRequest = undefined

    this.climatisationService = new hap.Service.Fan(this.name)
    this.lockService = new hap.Service.Switch(this.name)

    this.lockService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        this.log("Get locked state")
        
        if (this.lastRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastRequest.valueOf()) / 10000
 
          if (duration < 30) {
            this.log("Multiple requests within 30 seconds")
            return callback(null, this.locked)
          }
        } 
 
        this.lastRequest = new Date()
        
        try {
          this.getCurrentState('locked').then((isLocked) => {
            this.locked = isLocked
            callback(null, this.locked)
          }, (error) => {
            this.log.error("Get Error: " + error)
            callback()
          })
        }
        catch (error) {
          this.log.error("Try Get Error: " + error)
          callback()
        }
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.log(`Set locked state ${value}`)

        try {
          this.setCurrentState('locked', value == true ? '1' : '0').then(() => {
            this.locked = (value == "1")
            callback(null)
          }, (error) => {
            this.log.error("Set Error: " + error.message)
            setTimeout(() => {
              this.lockService.getCharacteristic(hap.Characteristic.On).updateValue(false)
            }, 1000); // Go back to turned off if error
            callback(null)
          })
        }
        catch (error) {
          this.log.error("Try Set Error: " + error)
          callback() // Unresponsive
        }
      })
 
    this.climatisationService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        this.log("Get climatisation state")
        
        if (this.lastRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastRequest.valueOf()) / 10000
 
          if (duration < 30) {
            this.log("Multiple requests within 30 seconds")
            return callback(null, this.climatisationOn)
          }
        } 
 
        this.lastRequest = new Date()
        
        try {
          this.getCurrentState('cabin-heating').then((on) => {
            this.climatisationOn = on
            callback(null, this.climatisationOn)
          }, (error) => {
            this.log.error("Get Error: " + error)
            callback()
          })
        }
        catch (error) {
          this.log.error("Try Get Error: " + error)
          callback()
        }
      })

      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.log(`Set climatisation state ${value}`)

        try {
          this.setCurrentState('cabin-heating', value == true ? '1' : '0').then(() => {
            this.climatisationOn = (value == "1")
            log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"))
            callback(null)
          }, (error) => {
            this.log.error("Set Error: " + error.message)
            setTimeout(() => {
              this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(false)
            }, 1000); // Go back to turned off if error
            callback(null)
          })
        }
        catch (error) {
          this.log.error("Try Set Error: " + error)
          callback() // Unresponsive
        }
      })

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, config.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, config.model)

    this.log("WeConnect finished initializing!")
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!")
  }

  async setCurrentState(command: string, value: string): Promise<void> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, '../main.py'), this.username, this.password, this.spin, command, value, this.vin])

    let success = false
    let error: string | undefined = undefined
    let currentState = false

    python.stderr.on('data', (data) => {
      error = data
      this.log("Python: " + error)
    })

    python.stdout.on('data', (data) => {
      let parsed = JSON.parse(data)
      if (command == 'cabin-heating') {
        currentState = parsed.cabinHeating
      }
      else if (command == 'locked') {
        currentState = parsed.locked
      }

      if (value == '1' && currentState) {
        success = true
      }
      else if (value == '0' && !currentState) {
        success = true
      }
    })

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (success) {
          this.lastRequest = undefined // Force refresh with get status
          resolve()

          setTimeout(async () => {
            this.lastRequest = undefined
            const state = await this.getCurrentState(command)
            console.log("State after 10 seconds: " + state)
            this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state)
          }, 10000)
        }
        else {
          reject(new Error(error))
        }
      })
    }), 10000, new Error(`Timed out setting state of ${command} to ${value}`))
  }

  async getCurrentState(command: string): Promise<boolean> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, '../main.py'), this.username, this.password, this.spin, command, 'status', this.vin])

    let success = false
    let error: string | undefined = undefined
    let currentState = false

    python.stderr.on('data', (data) => {
      error = data
      this.log("Python: " + error)
    })

    python.stdout.on('data', (data) => {
      let parsed = JSON.parse(data)
      if (command == 'cabin-heating') {
        currentState = parsed.cabinHeating
      }
      else if (command == 'locked') {
        currentState = parsed.locked
      }
      success = true
    }) 

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (success) {
          resolve(currentState)
        }
        else {
          reject(new Error(error))
        }
      })
    }), 10000, new Error(`Timed out getting state of ${command}`))
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [
      this.informationService,
      this.climatisationService,
      this.lockService
    ]
  }
}
