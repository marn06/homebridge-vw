import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge"

import timeoutPromise from "./timeoutPromise"
import { join } from 'path'
import { spawn } from 'child_process'

const packageJson = require('../package.json')

let hap: HAP

export = (api: API) => {
  hap = api.hap
  api.registerAccessory("homebridge-vw", "WeConnect", WeConnect)
}

class WeConnect implements AccessoryPlugin {
  private readonly log: Logging
  private readonly config: AccessoryConfig
  private readonly name: string
  private readonly climaterName: string
  private readonly lockName: string
  private readonly username: string
  private readonly password: string
  private readonly spin: string
  private readonly vin: string
  private readonly temperature?: number

  private readonly manufacturer: string
  private readonly model: string
  private readonly serial: string

  private lastClimatisationRequest: Date | undefined = undefined
  private lastLockedRequest: Date | undefined = undefined
  private climatisationOn = false
  private locked = false

  private readonly climatisationService: Service
  private readonly lockService: Service
  private readonly informationService: Service
  constructor(log: Logging, config: AccessoryConfig, api: API) {

    this.log = log
    this.config = config

    this.name = config.name
    this.climaterName = config['climaterName'] || "Climatisation"
    this.lockName = config['lockName'] || "Doors"
    this.username = config['username']
    this.password = config['password']
    this.spin = config['spin']
    this.vin = config['vin'] || ''
    this.temperature = config['temperature'] || 24.0

    this.manufacturer = config['manufacturer'] || packageJson['author']
    this.model = config['model'] || packageJson['name']
    this.serial = config['serial'] || packageJson['version']

    this.climatisationService = new hap.Service.Fan(this.name)
    this.climatisationService.getCharacteristic(hap.Characteristic.ConfiguredName)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        return callback(null, this.climaterName)
      })

    this.lockService = new hap.Service.LockMechanism(this.name)
    this.lockService.getCharacteristic(hap.Characteristic.ConfiguredName)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        return callback(null, this.lockName)
      })

    this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
      .onGet(async () => {
        this.log("Get locked state")

        if (this.lastLockedRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastLockedRequest.valueOf()) / 10000

          if (duration < 30) {
            this.log("Multiple requests within 30 seconds, ignored")
            const lockState = this.locked ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED
            this.lockService.getCharacteristic(hap.Characteristic.LockTargetState).updateValue(lockState)
            return lockState
          }
        }

        this.lastLockedRequest = new Date()

        try {
          await this.getCurrentState('locked').then((isLocked) => {
            this.locked = isLocked
          }, (error) => {
            this.log.error("Get locked state Error: " + error)
          })
        }
        catch (error) {
          this.log.error("Try get locked state Error: " + error)
        }
        const lockState = this.locked ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED
        this.lockService.getCharacteristic(hap.Characteristic.LockTargetState).updateValue(lockState)
        return lockState
      })

    this.lockService.getCharacteristic(hap.Characteristic.LockTargetState)
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set locked state ${value}`)
        let success = false
        try {
          await this.setCurrentState('locked', value.toString()).then(() => {
            this.locked = (value == hap.Characteristic.LockTargetState.SECURED)
            success = true
          }, (error) => {
            this.log.error("Set locked state Error: " + error.message)
          })
        }
        catch (error) {
          this.log.error("Try set locked state Error: " + error)
        }
        if (!success) {
          this.log("Revert to: " + (this.locked ? "SECURED" : "UNSECURED"))
          setTimeout(() => {
            this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
              .updateValue(this.locked ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED)
            this.lockService.getCharacteristic(hap.Characteristic.LockTargetState)
              .updateValue(this.locked ? hap.Characteristic.LockTargetState.SECURED : hap.Characteristic.LockTargetState.UNSECURED)
          }, 1000)
        }
      })

    this.climatisationService.getCharacteristic(hap.Characteristic.On)
      .onGet(async () => {
        this.log("Get climatisation state")

        if (this.lastClimatisationRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastClimatisationRequest.valueOf()) / 10000

          if (duration < 30) {
            this.log("Multiple requests within 30 seconds, ignored")
            return this.climatisationOn
          }
        }

        this.lastClimatisationRequest = new Date()

        try {
          await this.getCurrentState('climatisation').then((on) => {
            this.climatisationOn = on
            return this.climatisationOn
          }, (error) => {
            this.log.error("Get climatisation state Error: " + error)
          })
        }
        catch (error) {
          this.log.error("Try get climatisation state Error: " + error)
        }
        return false
      })

    this.climatisationService.getCharacteristic(hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set climatisation state ${value}`)

        try {
          await this.setCurrentState('climatisation', value ? '1' : '0').then(() => {
            this.climatisationOn = (value == "1")
            log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"))
          }, (error) => {
            this.log.error("Set climatisation state Error: " + error.message)
            setTimeout(() => {
              this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(false)
            }, 1000); // Go back to turned off if error
          })
        }
        catch (error) {
          this.log.error("Try set climatisation state Error: " + error)
        }
      })

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial)

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
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, '../main.py'),
    this.username, this.password, this.spin, command, value, this.vin, this.temperature!.toString()])

    let success = false
    let error: string | undefined = undefined
    let currentState = false

    python.stderr.on('data', (data) => {
      error = data
      this.log("Python: " + error)
    })

    python.stdout.on('data', (data) => {
      let parsed = JSON.parse(data)
      if (command == 'climatisation') {
        currentState = parsed.climatisation
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
      else {
        this.log(`Python error due to: Current State ${currentState} and Set Value ${value}`)
      }
    })

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (success) {
          // Force refresh with get status
          if (command == 'locked') {
            this.lastLockedRequest = undefined
          }
          else {
            this.lastClimatisationRequest = undefined
          }
          resolve()

          // Polls the car every 10 seconds to see if the queued action was succesfully handled.
          this.validateSetAction(command, value, 10000)
        }
        else {
          reject(new Error(error))
        }
      })
    }), 10000, new Error(`Timed out setting state of ${command} to ${value}`))
  }

  async validateSetAction(command: string, value: string, timeout: number) {
    const maxTries = 3
    this.runWithRetry(maxTries, async (tryNumber): Promise<boolean> => {
      if (tryNumber == maxTries) {
        if (command == 'locked') {
          this.lockService.getCharacteristic(hap.Characteristic.On).updateValue(null)
        }
        else {
          this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(null)
        }
        console.log(`Failed setting state of ${command} to ${value} after ${maxTries - 1} tries`);
        return false
      }

      return new Promise<boolean>((resolve, reject) => {
        setTimeout(async (boolean) => {
          try {
            // Force refresh with get status
            if (command == 'locked') {
              this.lastLockedRequest = undefined
            }
            else {
              this.lastClimatisationRequest = undefined
            }
            const state = await this.getCurrentState(command)
            console.log(`State after ${(timeout / 1000) * tryNumber} seconds: ` + state)
            const success = (state && value == '1') || (!state && value == '0')
            if (command == 'locked') {
              const lockState = state ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED
              if (success) {
                this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).updateValue(lockState)
              }
              else if (tryNumber == maxTries) { // If failed after max tries revert to actual state
                this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(lockState);
              }
              resolve(success)
            }
            else {
              if (success) {
                this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state)
              }
              else if (tryNumber == maxTries) { // If failed after max tries revert to actual state
                this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state);
              }
              resolve(success)
            }
          }
          catch {
            reject(new Error(`Failed to fetch new ${command} state after SET`))
          }
        }, timeout)
      })
    })
  }

  async runWithRetry(retryCount: number, action: (tries: number) => Promise<boolean>) {
    let tries = 1
    while (tries <= retryCount) {
      if (await action(tries)) {
        break
      }
      tries++
    }
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
      if (command == 'climatisation') {
        currentState = parsed.climatisation
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
      this.lockService,
      this.climatisationService
    ]
  }
}
