import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from 'homebridge'

import timeoutPromise from './timeoutPromise'
import { join } from 'path'
import { spawn } from 'child_process'

const packageJson = require('../package.json')

let hap: HAP

export = (api: API) => {
  hap = api.hap
  api.registerAccessory('homebridge-vw', 'WeConnect', WeConnect)
}

class WeConnect implements AccessoryPlugin {
  private readonly log: Logging
  private readonly config: AccessoryConfig
  private readonly name: string
  private readonly climaterName: string
  private readonly lockName: string
  private readonly chargingSwitchName: string
  private readonly username: string
  private readonly password: string
  private readonly spin: string
  private readonly vin: string
  private readonly temperature: number
  private readonly pollInterval: number

  private readonly manufacturer: string
  private readonly model: string
  private readonly serial: string

  private lastClimatisationRequest: Date | undefined = undefined
  private lastLockedRequest: Date | undefined = undefined
  private lastBatteryRequest: Date | undefined = undefined
  private climatisationOn = false
  private locked = false
  private charging = false
  private batteryLevel = 0

  private readonly climatisationService: Service
  private readonly lockService: Service
  private readonly batteryService: Service
  private readonly chargingSwitchService: Service
  private readonly informationService: Service
  constructor(log: Logging, config: AccessoryConfig, api: API) {

    this.log = log
    this.config = config

    this.name = config.name
    this.climaterName = config['climaterName'] || 'Climatisation'
    this.lockName = config['lockName'] || 'Doors'
    this.chargingSwitchName = config['chargingSwitchName'] || 'Charging'
    this.username = config['username']
    this.password = config['password']
    this.spin = config['spin']
    this.vin = config['vin'] || ''
    this.temperature = config['temperature'] || 24.0
    this.pollInterval = config['pollInterval'] || 60.0

    this.manufacturer = config['manufacturer'] || packageJson['author']
    this.model = config['model'] || packageJson['name']
    this.serial = config['serial'] || packageJson['version']

    this.climatisationService = new hap.Service.Fan(this.name)
    this.climatisationService.getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.climaterName
      })

    this.lockService = new hap.Service.LockMechanism(this.name)
    this.lockService.getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.lockName
      })

    this.chargingSwitchService = new hap.Service.Switch(this.name)
    this.chargingSwitchService.getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.chargingSwitchName
      })

    this.chargingSwitchService.getCharacteristic(hap.Characteristic.On)
      .onGet(async () => {
        return this.charging
      })
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set charging state ${value}`)
        try {
          await this.setCurrentState('charging', value ? '1' : '0').then(() => {
            this.charging = (value == '1')
            log('Charging: ' + (this.charging ? 'ON' : 'OFF'))
          }, (error) => {
            this.log.error('Set charging state Error: ' + error.message)
            setTimeout(() => {
              this.chargingSwitchService.getCharacteristic(hap.Characteristic.On).updateValue(!value)
            }, 1000); // Go back to old value if error
          })
        }
        catch (error) {
          this.log.error('Try set charging state: ' + error)
        }
      })

    this.batteryService = new hap.Service.Battery(this.name)

    /*     this.batteryService.getCharacteristic(hap.Characteristic.StatusLowBattery)
          .onGet(async () => {
            if (this.batteryLevel < 10) {
              return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
            }
            return hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
          }) */

    this.batteryService.getCharacteristic(hap.Characteristic.BatteryLevel)
      .onGet(async () => {
        this.log('Get battery state')

        if (this.lastBatteryRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastBatteryRequest.valueOf()) / 1000

          if (duration < this.pollInterval) {
            this.log(`Multiple requests within ${this.pollInterval} seconds, ignored`)
            return this.batteryLevel
          }
        }

        this.lastBatteryRequest = new Date()

        try {
          await this.getCurrentState('charging').catch((error) => {
            this.log.error('Get battery state: ' + error)
          })
        }
        catch (error) {
          this.log.error('Try get battery state: ' + error)
        }

        const chargingState = this.charging ? hap.Characteristic.ChargingState.CHARGING : hap.Characteristic.ChargingState.NOT_CHARGING
        this.batteryService.getCharacteristic(hap.Characteristic.ChargingState).updateValue(chargingState)

        return this.batteryLevel
      })

    this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
      .onGet(async () => {
        this.log('Get locked state')

        let fetchState = true
        if (this.lastLockedRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastLockedRequest.valueOf()) / 1000

          if (duration < this.pollInterval) {
            this.log(`Multiple requests within ${this.pollInterval} seconds, ignored`)
            fetchState = false
          }
        }

        if (fetchState) {
          this.lastLockedRequest = new Date()

          try {
            await this.getCurrentState('locked').catch((error) => {
              this.log.error('Get locked state: ' + error)
            })
          }
          catch (error) {
            this.log.error('Try get locked state: ' + error)
          }
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
            this.log.error('Set locked state: ' + error.message)
          })
        }
        catch (error) {
          this.log.error('Try set locked state: ' + error)
        }
        if (!success) {
          this.log('Revert to: ' + (this.locked ? 'SECURED' : 'UNSECURED'))
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
        this.log('Get climatisation state')

        if (this.lastClimatisationRequest != undefined) {
          var now = new Date()
          var duration = (now.valueOf() - this.lastClimatisationRequest.valueOf()) / 1000

          if (duration < this.pollInterval) {
            this.log(`Multiple requests within ${this.pollInterval} seconds, ignored`)
            return this.climatisationOn
          }
        }

        this.lastClimatisationRequest = new Date()

        try {
          await this.getCurrentState('climatisation').catch((error) => {
            this.log.error('Get climatisation state: ' + error)
          })
        }
        catch (error) {
          this.log.error('Try get climatisation state: ' + error)
        }
        return this.climatisationOn
      })

    this.climatisationService.getCharacteristic(hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set climatisation state ${value}`)

        try {
          await this.setCurrentState('climatisation', value ? '1' : '0').then(() => {
            this.climatisationOn = (value == '1')
            log('Climatisation: ' + (this.climatisationOn ? 'ON' : 'OFF'))
          }, (error) => {
            this.log.error('Set climatisation state Error: ' + error.message)
            setTimeout(() => {
              this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(!value)
            }, 1000); // Go back to old value if error 
          })
        }
        catch (error) {
          this.log.error('Try set climatisation state: ' + error)
        }
      })

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial)

    this.log('WeConnect finished initializing!')
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log('Identify!')
  }

  async setCurrentState(command: string, value: string): Promise<void> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, 'main.py'),
    this.username, this.password, this.spin, command, value, this.vin, this.temperature!.toString()])

    let success = false
    let error: string | undefined = undefined
    let currentState = false

    python.stderr.on('data', (data) => {
      error = data
      this.log('Python: ' + error)
    })

    python.stdout.on('data', (data) => {
      let parsed = JSON.parse(data)
      if (command == 'climatisation') {
        currentState = parsed.climatisation
      }
      else if (command == 'locked') {
        currentState = parsed.locked
      }
      else if (command == 'charging') {
        currentState = parsed.charging
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
          this.validateSetAction(command, value, 10000, 3)
        }
        else {
          reject(new Error(error))
        }
      })
    }), 10000, new Error(`Timed out setting state of ${command} to ${value}`))
  }

  async validateSetAction(command: string, value: string, timeout: number, maxTries: number) {
    this.runWithRetry(maxTries, async (tryNumber): Promise<boolean> => {
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

            await this.getCurrentState(command).catch((error) => {
              reject(error)
            })

            let state: any = undefined
            if (command == 'charging') {
              state = this.charging
            }
            else if (command == 'locked') {
              state = this.locked
            }
            else if (command == 'climatisation') {
              state = this.climatisationOn
            }

            console.log(`State after ${(timeout / 1000) * tryNumber} seconds: ` + command + ' = ' + state)
            const success = (state && value == '1') || (!state && value == '0')
            if (command == 'charging') {
              if (success) {
                this.chargingSwitchService.getCharacteristic(hap.Characteristic.On).updateValue(state)
              }
              else if (tryNumber == maxTries) { // If failed after max tries revert to actual state
                const chargingState = state ? hap.Characteristic.ChargingState.CHARGING : hap.Characteristic.ChargingState.NOT_CHARGING
                this.batteryService.getCharacteristic(hap.Characteristic.ChargingState).updateValue(chargingState)
                this.chargingSwitchService.getCharacteristic(hap.Characteristic.On).updateValue(state)
                console.log(`Failed setting state of ${command} to ${value} after ${maxTries} tries`)
              }
              resolve(success)
            }
            else if (command == 'locked') {
              const lockState = state ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED
              if (success) {
                this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).updateValue(lockState)
              }
              else if (tryNumber == maxTries) { // If failed after max tries revert to actual state
                this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).updateValue(lockState);
                this.lockService.getCharacteristic(hap.Characteristic.LockTargetState).updateValue(lockState);
                console.log(`Failed setting state of ${command} to ${value} after ${maxTries} tries`)
              }
              resolve(success)
            }
            else if (command == 'climatisation') {
              if (success) {
                this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state)
              }
              else if (tryNumber == maxTries) { // If failed after max tries revert to actual state
                this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state)
                console.log(`Failed setting state of ${command} to ${value} after ${maxTries} tries`)
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

  async getCurrentState(command: string): Promise<void> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, 'main.py'), this.username, this.password, this.spin, command, 'status', this.vin])

    let success = false
    let error: string | undefined = undefined

    python.stderr.on('data', (data) => {
      error = data
      this.log('Python: ' + error)
    })

    python.stdout.on('data', (data) => {
      try {
        let parsed = JSON.parse(data)
        if (command == 'climatisation') {
          this.climatisationOn = parsed.climatisation
        }
        else if (command == 'locked') {
          this.locked = parsed.locked
        }
        else if (command == 'charging') {
          this.charging = parsed.charging
          this.batteryLevel = parsed.batteryLevel
        }
        success = true
      }
      catch (dataError) {
        this.log.error('Get current state on data received: ' + dataError)
      }
    })

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (success) {
          resolve()
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
      this.climatisationService,
      this.batteryService,
      this.chargingSwitchService
    ]
  }
}
