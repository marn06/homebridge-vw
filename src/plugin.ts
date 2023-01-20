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

import timeoutPromise from "./timeoutPromise";
import { join } from 'path';
import { ChildProcess, spawn } from 'child_process';

let hap: HAP

export = (api: API) => {
  hap = api.hap
  api.registerAccessory("homebridge-vw", "Climatisation", Climatisation)
}

class Climatisation implements AccessoryPlugin {
  private readonly log: Logging
  private readonly config: AccessoryConfig
  private readonly name: string
  private readonly username: string
  private readonly password: string
  private readonly spin: string

  private lastRequest: Date
  private climatisationOn = false

  private readonly fanService: Service
  private readonly informationService: Service
  constructor(log: Logging, config: AccessoryConfig, api: API) {

    this.log = log
    this.name = config.name
    this.config = config

    this.username = config['username']
    this.password = config['password']
    this.spin = config['spin']

    this.lastRequest = new Date()

    this.fanService = new hap.Service.Fan(this.name)
    this.fanService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        this.log("Get climatisation state")

        var now = new Date();
        var duration = (now.valueOf() - this.lastRequest.valueOf()) / 10000;

        this.log("duration: " + duration)

        try {
          this.getCurrentState('cabin-heating').then((on) => {
            this.climatisationOn = on
            log.info("Climatisation " + (this.climatisationOn ? "ON" : "OFF"))
            callback(null, this.climatisationOn)
          }, (err) => {
            this.log.error(err.message)
            callback()
          })
        }
        catch (error: any) {
          this.log(error)
          callback()
        }
      })

      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.log(`Set climatisation state ${value}`)

        try {
          this.setCurrentState('cabin-heating', value.toString()).then(() => {
            this.climatisationOn = (value == "1")
            log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"))
            callback(null)
          }, (err) => {
            this.log.error(err.message)
            callback()
          })
        }
        catch (error: any) {
          this.log(error)
          callback()
        }
      })

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, config.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, config.model)

    this.log("Climatisation finished initializing!")
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!")
  }

  async setCurrentState(command: string, value: string): Promise<void> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, '../main.py'), this.username, this.password, this.spin, command, value]);

    let error: string | null = null
    let success: boolean = false

    python.stderr.on('data', (data) => {
      error = data
      this.log("Error: " + data)
    });

    python.stdout.on('data', (data) => {
      let parsed = JSON.parse(data)
      success = parsed.currentState == value
      this.log(data)
    });

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (error) {
          reject(error)
        }
        else {
          resolve()
        }
      })
    }), 10000, new Error(`Timed out setting state of ${command} to ${value}`))
  }

  async getCurrentState(command: string): Promise<boolean> {
    let python = spawn(join(__dirname, '/venv/bin/python3'), [join(__dirname, '../main.py'), this.username, this.password, this.spin, command, 'status']);

    let error: string | null = null
    let currentState = false

    python.stderr.on('data', (data) => {
      this.log("Error: " + data)
      error = data
    });

    python.stdout.on('data', (data) => {
      this.log(data)
      let parsed = JSON.parse(data)
      if (command == 'cabin-heating') {
        currentState = parsed.cabinHeating
      }
      else if (command == 'locked') {
        currentState = parsed.locked
      }
    });

    return timeoutPromise(new Promise((resolve, reject) => {
      python.on('close', (code) => {
        if (error) {
          reject(error)
        }
        else {
          resolve(currentState)
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
      this.fanService,
    ]
  }
}
