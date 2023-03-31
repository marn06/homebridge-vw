import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
} from "homebridge";

import timeoutPromise from "./timeoutPromise";
import { join } from "path";
import { spawn } from "child_process";

const packageJson = require("../package.json");

let hap: HAP;

export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("homebridge-vw", "WeConnect", WeConnect);
};

class WeConnect implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly config: AccessoryConfig;
  private readonly name: string;
  private readonly climaterName: string;
  private readonly windowHeatingName: string;
  private readonly lockName: string;
  private readonly chargingSwitchName: string;
  private readonly pollInterval: number;
  private readonly combineHeating: boolean;

  private readonly manufacturer: string;
  private readonly model: string;
  private readonly serial: string;

  private lastStatusRequest: Date | undefined = undefined;
  private climatisationOn = false;
  private windowHeatingOn = false;
  private locked = false;
  private charging = false;
  private batteryLevel = 0;

  private getStatusPromise: Promise<void> | undefined = undefined;

  private readonly services: Service[] = [];
  private readonly climatisationService: Service;
  private readonly windowHeatingService: Service;
  private readonly lockService: Service;
  private readonly batteryService: Service;
  private readonly chargingSwitchService: Service;
  private readonly informationService: Service;
  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.config = config;

    config["temperature"] = config["temperature"] || 24.0;
    config["vin"] = config["vin"] || "";
    config["combineHeating"] = config["combineHeating"] || false;

    this.name = config.name;
    this.climaterName = config["climaterName"] || "Climatisation";
    this.windowHeatingName = config["windowHeatingName"] || "Window Heating";
    this.lockName = config["lockName"] || "Doors";
    this.chargingSwitchName = config["chargingSwitchName"] || "Charging";
    this.pollInterval = config["pollInterval"] || 60.0;
    this.combineHeating = config["combineHeating"] || false;

    this.manufacturer = config["manufacturer"] || packageJson["author"];
    this.model = config["model"] || packageJson["name"];
    this.serial = config["serial"] || packageJson["version"];

    this.climatisationService = new hap.Service.Fan(this.name, "Climatisation");
    this.climatisationService
      .getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.climaterName;
      });
    this.services.push(this.climatisationService);

    this.windowHeatingService = new hap.Service.Fan(
      this.name,
      "Window Heating"
    );

    if (!this.combineHeating) {
      this.windowHeatingService
        .getCharacteristic(hap.Characteristic.ConfiguredName)
        .onGet(async () => {
          return this.windowHeatingName;
        });
      this.services.push(this.windowHeatingService);
    }

    this.lockService = new hap.Service.LockMechanism(this.name);
    this.lockService
      .getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.lockName;
      });
    this.services.push(this.lockService);

    this.chargingSwitchService = new hap.Service.Switch(this.name);
    this.chargingSwitchService
      .getCharacteristic(hap.Characteristic.ConfiguredName)
      .onGet(async () => {
        return this.chargingSwitchName;
      });
    this.services.push(this.chargingSwitchService);

    this.batteryService = new hap.Service.Battery(this.name);
    this.services.push(this.batteryService);

    this.chargingSwitchService
      .getCharacteristic(hap.Characteristic.On)
      .onGet(async () => {
        if (this.getStatusPromise) {
          await this.getStatusPromise;
        }
        return this.charging;
      })
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set charging state ${value}`);
        try {
          await this.setCurrentState("charging", value ? "1" : "0").then(
            () => {
              this.charging = value == "1";
              log("Charging: " + (this.charging ? "ON" : "OFF"));
            },
            (error) => {
              this.log.error("Set charging state Error: " + error.message);
              setTimeout(() => {
                this.chargingSwitchService
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(!value);
              }, 1000); // Go back to old value if error
            }
          );
        } catch (error) {
          this.log.error("Try set charging state: " + error);
        }
      });

    this.batteryService
      .getCharacteristic(hap.Characteristic.BatteryLevel)
      .onGet(async () => {
        this.log("Get battery state");

        if (this.lastStatusRequest != undefined) {
          var now = new Date();
          var duration =
            (now.valueOf() - this.lastStatusRequest.valueOf()) / 1000;

          if (duration < this.pollInterval) {
            this.log(`Multiple requests within ${this.pollInterval} seconds`);
            if (this.getStatusPromise) {
              await this.getStatusPromise;
              this.log(`Battery level: ${this.batteryLevel}`);
              this.log(`Charging: ${this.charging}`);
            } else {
              this.log(`Last known battery level: ${this.batteryLevel}`);
              this.log(`Last known state of charging: ${this.charging}`);
            }
            return this.batteryLevel;
          }
        }

        this.lastStatusRequest = new Date();

        try {
          this.getStatusPromise = this.getCurrentState().catch((error) => {
            this.log.error("Get battery state: " + error);
          });
          await this.getStatusPromise;
        } catch (error) {
          this.log.error("Try get battery state: " + error);
        }

        const chargingState = this.charging
          ? hap.Characteristic.ChargingState.CHARGING
          : hap.Characteristic.ChargingState.NOT_CHARGING;
        this.batteryService
          .getCharacteristic(hap.Characteristic.ChargingState)
          .updateValue(chargingState);

        return this.batteryLevel;
      });

    this.lockService
      .getCharacteristic(hap.Characteristic.LockCurrentState)
      .onGet(async () => {
        this.log.info("Get locked state");

        let fetchState = true;
        if (this.lastStatusRequest != undefined) {
          var now = new Date();
          var duration =
            (now.valueOf() - this.lastStatusRequest.valueOf()) / 1000;

          if (duration < this.pollInterval) {
            this.log.info(
              `Multiple requests within ${this.pollInterval} seconds`
            );
            if (this.getStatusPromise) {
              await this.getStatusPromise;
              this.log.info(`Locked: ${this.locked}`);
            } else {
              this.log.info(`Last known state of locked: ${this.locked}`);
            }
            fetchState = false;
          }
        }

        if (fetchState) {
          this.lastStatusRequest = new Date();

          try {
            this.getStatusPromise = this.getCurrentState().catch((error) => {
              this.log.error("Get locked state: " + error);
            });
            await this.getStatusPromise;
          } catch (error) {
            this.log.error("Try get locked state: " + error);
          }
        }

        const lockState = this.locked
          ? hap.Characteristic.LockCurrentState.SECURED
          : hap.Characteristic.LockCurrentState.UNSECURED;
        this.lockService
          .getCharacteristic(hap.Characteristic.LockTargetState)
          .updateValue(lockState);

        return lockState;
      });

    this.lockService
      .getCharacteristic(hap.Characteristic.LockTargetState)
      .onSet(async (value: CharacteristicValue) => {
        this.log(
          `Set locked state ${
            value == hap.Characteristic.LockTargetState.SECURED
              ? "true"
              : "false"
          }`
        );
        let success = false;
        try {
          await this.setCurrentState("locked", value.toString()).then(
            () => {
              this.locked = value == hap.Characteristic.LockTargetState.SECURED;
              success = true;
            },
            (error) => {
              this.log.error("Set locked state: " + error.message);
            }
          );
        } catch (error) {
          this.log.error("Try set locked state: " + error);
        }
        if (!success) {
          this.log("Revert to: " + (this.locked ? "SECURED" : "UNSECURED"));
          setTimeout(() => {
            this.lockService
              .getCharacteristic(hap.Characteristic.LockCurrentState)
              .updateValue(
                this.locked
                  ? hap.Characteristic.LockCurrentState.SECURED
                  : hap.Characteristic.LockCurrentState.UNSECURED
              );
            this.lockService
              .getCharacteristic(hap.Characteristic.LockTargetState)
              .updateValue(
                this.locked
                  ? hap.Characteristic.LockTargetState.SECURED
                  : hap.Characteristic.LockTargetState.UNSECURED
              );
          }, 1000);
        }
      });

    this.climatisationService
      .getCharacteristic(hap.Characteristic.On)
      .onGet(async () => {
        this.log.info("Get climatisation state");

        if (this.lastStatusRequest != undefined) {
          var now = new Date();
          var duration =
            (now.valueOf() - this.lastStatusRequest.valueOf()) / 1000;

          if (duration < this.pollInterval) {
            this.log.info(
              `Multiple requests within ${this.pollInterval} seconds`
            );
            if (this.getStatusPromise) {
              await this.getStatusPromise;
              this.log.info(`Climatisation: ${this.climatisationOn}`);
            } else {
              this.log.info(
                `Last known state of climatisation: ${this.climatisationOn}`
              );
            }
            return this.climatisationOn;
          }
        }

        this.lastStatusRequest = new Date();

        try {
          this.getStatusPromise = this.getCurrentState().catch((error) => {
            this.log.error("Get climatisation state: " + error);
          });
          await this.getStatusPromise;
        } catch (error) {
          this.log.error("Try get climatisation state: " + error);
        }
        return this.climatisationOn;
      });

    this.climatisationService
      .getCharacteristic(hap.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.log(`Set climatisation state ${value}`);

        try {
          await this.setCurrentState("climatisation", value ? "1" : "0").then(
            () => {
              this.climatisationOn = value == "1";
              log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"));
            },
            (error) => {
              this.log.error("Set climatisation state Error: " + error.message);
              setTimeout(() => {
                this.climatisationService
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(!value);
              }, 1000); // Go back to old value if error
            }
          );
        } catch (error) {
          this.log.error("Try set climatisation state: " + error);
        }
      });

    if (!this.combineHeating) {
      this.windowHeatingService
        .getCharacteristic(hap.Characteristic.On)
        .onGet(async () => {
          this.log.info("Get window heating state");

          if (this.lastStatusRequest != undefined) {
            var now = new Date();
            var duration =
              (now.valueOf() - this.lastStatusRequest.valueOf()) / 1000;

            if (duration < this.pollInterval) {
              this.log.info(
                `Multiple requests within ${this.pollInterval} seconds`
              );
              if (this.getStatusPromise) {
                await this.getStatusPromise;
                this.log.info(`Window heating: ${this.windowHeatingOn}`);
              } else {
                this.log.info(
                  `Last known state of window heating: ${this.windowHeatingOn}`
                );
              }
              return this.windowHeatingOn;
            }
          }

          this.lastStatusRequest = new Date();

          try {
            this.getStatusPromise = this.getCurrentState().catch((error) => {
              this.log.error("Get window heating state: " + error);
            });
            await this.getStatusPromise;
          } catch (error) {
            this.log.error("Try get window heating state: " + error);
          }
          return this.windowHeatingOn;
        });

      this.windowHeatingService
        .getCharacteristic(hap.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          this.log(`Set window heating state ${value}`);

          try {
            await this.setCurrentState("windowHeating", value ? "1" : "0").then(
              () => {
                this.windowHeatingOn = value == "1";
                log("Window Heating: " + (this.windowHeatingOn ? "ON" : "OFF"));
              },
              (error) => {
                this.log.error(
                  "Set window heating state Error: " + error.message
                );
                setTimeout(() => {
                  this.windowHeatingService
                    .getCharacteristic(hap.Characteristic.On)
                    .updateValue(!value);
                }, 1000); // Go back to old value if error
              }
            );
          } catch (error) {
            this.log.error("Try set window heating state: " + error);
          }
        });
    }

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(hap.Characteristic.Model, this.model)
      .setCharacteristic(hap.Characteristic.SerialNumber, this.serial);

    this.services.push(this.informationService);

    this.log("WeConnect finished initializing!");
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log("Identify!");
  }

  async setCurrentState(command: string, value: string): Promise<void> {
    let python = spawn(join(__dirname, "/venv/bin/python3"), [
      join(__dirname, "main.py"),
      JSON.stringify(this.config),
      command,
      value,
    ]);

    let success = false;
    let error: string | undefined = undefined;
    let currentState = false;

    python.stderr.on("data", (data) => {
      error = data;
      this.log("Python: " + error);
    });

    python.stdout.on("data", (data) => {
      let parsed = JSON.parse(data);
      if (command == "climatisation") {
        currentState = this.combineHeating
          ? parsed.climatisation && parsed.windowHeating
          : parsed.climatisation;
      } else if (command == "window-heating") {
        currentState = parsed.windowHeating;
      } else if (command == "locked") {
        currentState = parsed.locked;
      } else if (command == "charging") {
        currentState = parsed.charging;
      }

      if (value == "1" && currentState) {
        success = true;
      } else if (value == "0" && !currentState) {
        success = true;
      } else {
        this.log(
          `Python error due to: Current State ${currentState} and Set Value ${value}`
        );
      }
    });

    return timeoutPromise(
      new Promise((resolve, reject) => {
        python.on("close", (code) => {
          if (success) {
            // Force refresh with get status
            this.lastStatusRequest = undefined;
            resolve();

            // Polls the car every 10 seconds to see if the queued action was succesfully handled.
            this.validateSetAction(command, value, 10000, 3);
          } else {
            reject(new Error(error));
          }
        });
      }),
      10000,
      new Error(`Timed out setting state of ${command} to ${value}`)
    );
  }

  async validateSetAction(
    command: string,
    value: string,
    timeout: number,
    maxTries: number
  ) {
    this.runWithRetry(maxTries, async (tryNumber): Promise<boolean> => {
      return new Promise<boolean>((resolve, reject) => {
        setTimeout(async (boolean) => {
          try {
            // Force refresh with get status
            this.lastStatusRequest = undefined;

            this.getStatusPromise = this.getCurrentState(command).catch(
              (error) => {
                reject(error);
              }
            );
            await this.getStatusPromise;

            let state: any = undefined;
            if (command == "charging") {
              state = this.charging;
            } else if (command == "locked") {
              state = this.locked;
            } else if (command == "climatisation") {
              state = this.climatisationOn;
            } else if (command == "window-heating") {
              state = this.windowHeatingOn;
            }

            console.log(
              `State after ${(timeout / 1000) * tryNumber} seconds: ` +
                command +
                " = " +
                state
            );
            const success = (state && value == "1") || (!state && value == "0");
            if (command == "charging") {
              if (success) {
                this.chargingSwitchService
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(state);
              } else if (tryNumber == maxTries) {
                // If failed after max tries revert to actual state
                const chargingState = state
                  ? hap.Characteristic.ChargingState.CHARGING
                  : hap.Characteristic.ChargingState.NOT_CHARGING;
                this.batteryService
                  .getCharacteristic(hap.Characteristic.ChargingState)
                  .updateValue(chargingState);
                this.chargingSwitchService
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(state);
                console.log(
                  `Failed setting state of ${command} to ${value} after ${maxTries} tries`
                );
              }
              resolve(success);
            } else if (command == "locked") {
              const lockState = state
                ? hap.Characteristic.LockCurrentState.SECURED
                : hap.Characteristic.LockCurrentState.UNSECURED;
              if (success) {
                this.lockService
                  .getCharacteristic(hap.Characteristic.LockCurrentState)
                  .updateValue(lockState);
              } else if (tryNumber == maxTries) {
                // If failed after max tries revert to actual state
                this.lockService
                  .getCharacteristic(hap.Characteristic.LockCurrentState)
                  .updateValue(lockState);
                this.lockService
                  .getCharacteristic(hap.Characteristic.LockTargetState)
                  .updateValue(lockState);
                console.log(
                  `Failed setting state of ${command} to ${value} after ${maxTries} tries`
                );
              }
              resolve(success);
            } else if (
              command == "climatisation" ||
              command == "window-heating"
            ) {
              const service =
                command == "climatisation"
                  ? this.climatisationService
                  : this.windowHeatingService;
              if (success) {
                service
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(state);
              } else if (tryNumber == maxTries) {
                // If failed after max tries revert to actual state
                service
                  .getCharacteristic(hap.Characteristic.On)
                  .updateValue(state);
                console.log(
                  `Failed setting state of ${command} to ${value} after ${maxTries} tries`
                );
              }
              resolve(success);
            }
          } catch {
            reject(new Error(`Failed to fetch new ${command} state after SET`));
          }
        }, timeout);
      });
    });
  }

  async runWithRetry(
    retryCount: number,
    action: (tries: number) => Promise<boolean>
  ) {
    let tries = 1;
    while (tries <= retryCount) {
      if (await action(tries)) {
        break;
      }
      tries++;
    }
  }

  async getCurrentState(command: string = ""): Promise<void> {
    let python = spawn(join(__dirname, "/venv/bin/python3"), [
      join(__dirname, "main.py"),
      JSON.stringify(this.config),
      command,
      "status",
    ]);

    let success = false;
    let error: string | undefined = undefined;

    python.stderr.on("data", (data) => {
      error = data;
      this.log("Python: " + error);
    });

    python.stdout.on("data", (data) => {
      try {
        let parsed = JSON.parse(data);
        this.climatisationOn = this.combineHeating
          ? parsed.climatisation && parsed.windowHeating
          : parsed.climatisation;
        this.windowHeatingOn = parsed.windowHeating;
        this.locked = parsed.locked;
        this.charging = parsed.charging;
        this.batteryLevel = parsed.batteryLevel;
        success = true;
      } catch (dataError) {
        this.log.error("Get current state on data received: " + dataError);
      }
    });

    return timeoutPromise(
      new Promise((resolve, reject) => {
        python.on("close", (code) => {
          if (success) {
            resolve();
          } else {
            reject(new Error(error));
          }
        });
      }),
      10000,
      new Error(`Timed out getting state of ${command}`)
    );
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return this.services;
  }
}
