"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const timeoutPromise_1 = __importDefault(require("./timeoutPromise"));
const path_1 = require("path");
const child_process_1 = require("child_process");
let hap;
class WeConnect {
    constructor(log, config, api) {
        this.name = "";
        this.climaterName = "";
        this.lockName = "";
        this.username = "";
        this.password = "";
        this.spin = "";
        this.vin = "";
        this.lastClimatisationRequest = undefined;
        this.lastLockedRequest = undefined;
        this.climatisationOn = false;
        this.locked = false;
        this.log = log;
        this.config = config;
        this.name = config.name;
        this.climaterName = config['climaterName'] = "Climatisation";
        this.lockName = config['lockName'] = "Doors";
        this.username = config['username'];
        this.password = config['password'];
        this.spin = config['spin'];
        this.vin = config['vin'];
        this.climatisationService = new hap.Service.Fan(this.name);
        this.climatisationService.getCharacteristic(hap.Characteristic.ConfiguredName)
            .on("get" /* CharacteristicEventTypes.GET */, (callback) => {
            return callback(null, this.climaterName);
        });
        this.lockService = new hap.Service.LockMechanism(this.name);
        this.lockService.getCharacteristic(hap.Characteristic.ConfiguredName)
            .on("get" /* CharacteristicEventTypes.GET */, (callback) => {
            return callback(null, this.lockName);
        });
        this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
            .onGet(async () => {
            this.log("Get locked state");
            if (this.lastLockedRequest != undefined) {
                var now = new Date();
                var duration = (now.valueOf() - this.lastLockedRequest.valueOf()) / 10000;
                if (duration < 30) {
                    this.log("Multiple requests within 30 seconds");
                    this.lockService.getCharacteristic(hap.Characteristic.LockTargetState).updateValue(this.locked);
                    return this.locked;
                }
            }
            this.lastLockedRequest = new Date();
            try {
                await this.getCurrentState('locked').then((isLocked) => {
                    this.locked = isLocked;
                    this.lockService.getCharacteristic(hap.Characteristic.LockTargetState).updateValue(this.locked);
                    return this.locked;
                }, (error) => {
                    this.log.error("Get Error: " + error);
                });
            }
            catch (error) {
                this.log.error("Try Get Error: " + error);
            }
            return false;
        });
        this.lockService.getCharacteristic(hap.Characteristic.LockTargetState)
            .onSet(async (value) => {
            this.log(`Set locked state ${value}`);
            let success = false;
            try {
                await this.setCurrentState('locked', value.toString()).then(() => {
                    this.locked = (value == hap.Characteristic.LockTargetState.SECURED);
                    success = true;
                }, (error) => {
                    this.log.error("Set Error: " + error.message);
                });
            }
            catch (error) {
                this.log.error("Try Set Error: " + error);
            }
            if (!success) {
                this.log("Revert to: " + (this.locked ? "SECURED" : "UNSECURED"));
                setTimeout(() => {
                    this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState)
                        .updateValue(this.locked ? hap.Characteristic.LockCurrentState.SECURED : hap.Characteristic.LockCurrentState.UNSECURED);
                    this.lockService.getCharacteristic(hap.Characteristic.LockTargetState)
                        .updateValue(this.locked ? hap.Characteristic.LockTargetState.SECURED : hap.Characteristic.LockTargetState.UNSECURED);
                }, 1000);
            }
        });
        this.climatisationService.getCharacteristic(hap.Characteristic.On)
            .onGet(async () => {
            this.log("Get climatisation state");
            if (this.lastClimatisationRequest != undefined) {
                var now = new Date();
                var duration = (now.valueOf() - this.lastClimatisationRequest.valueOf()) / 10000;
                if (duration < 30) {
                    this.log("Multiple requests within 30 seconds");
                    return this.climatisationOn ? hap.Characteristic.CurrentFanState.BLOWING_AIR : hap.Characteristic.CurrentFanState.INACTIVE;
                }
            }
            this.lastClimatisationRequest = new Date();
            try {
                await this.getCurrentState('climatisation').then((on) => {
                    this.climatisationOn = on;
                    return this.climatisationOn;
                }, (error) => {
                    this.log.error("Get Error: " + error);
                });
            }
            catch (error) {
                this.log.error("Try Get Error: " + error);
            }
            return false;
        });
        this.climatisationService.getCharacteristic(hap.Characteristic.On)
            .onSet(async (value) => {
            this.log(`Set climatisation state ${value}`);
            try {
                await this.setCurrentState('climatisation', value ? '1' : '0').then(() => {
                    this.climatisationOn = (value == "1");
                    log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"));
                }, (error) => {
                    this.log.error("Set Error: " + error.message);
                    setTimeout(() => {
                        this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(false);
                    }, 1000); // Go back to turned off if error
                });
            }
            catch (error) {
                this.log.error("Try Set Error: " + error);
            }
        });
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, config.manufacturer)
            .setCharacteristic(hap.Characteristic.Model, config.model);
        this.log("WeConnect finished initializing!");
    }
    /*
     * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
     * Typical this only ever happens at the pairing process.
     */
    identify() {
        this.log("Identify!");
    }
    async setCurrentState(command, value) {
        let python = (0, child_process_1.spawn)((0, path_1.join)(__dirname, '/venv/bin/python3'), [(0, path_1.join)(__dirname, '../main.py'), this.username, this.password, this.spin, command, value, this.vin]);
        let success = false;
        let error = undefined;
        let currentState = false;
        python.stderr.on('data', (data) => {
            error = data;
            this.log("Python: " + error);
        });
        python.stdout.on('data', (data) => {
            let parsed = JSON.parse(data);
            if (command == 'climatisation') {
                currentState = parsed.cabinHeating;
            }
            else if (command == 'locked') {
                currentState = parsed.locked;
            }
            if (value == '1' && currentState) {
                success = true;
            }
            else if (value == '0' && !currentState) {
                success = true;
            }
        });
        return (0, timeoutPromise_1.default)(new Promise((resolve, reject) => {
            python.on('close', (code) => {
                if (success) {
                    // Force refresh with get status
                    if (command == 'locked') {
                        this.lastLockedRequest = undefined;
                    }
                    else {
                        this.lastClimatisationRequest = undefined;
                    }
                    resolve();
                    setTimeout(async () => {
                        // Force refresh with get status
                        if (command == 'locked') {
                            this.lastLockedRequest = undefined;
                        }
                        else {
                            this.lastClimatisationRequest = undefined;
                        }
                        const state = await this.getCurrentState(command);
                        console.log("State after 15 seconds: " + state);
                        if (command == 'locked') {
                            this.lockService.getCharacteristic(hap.Characteristic.LockCurrentState).updateValue(state);
                        }
                        else {
                            this.climatisationService.getCharacteristic(hap.Characteristic.On).updateValue(state);
                        }
                    }, 15000);
                }
                else {
                    reject(new Error(error));
                }
            });
        }), 10000, new Error(`Timed out setting state of ${command} to ${value}`));
    }
    async getCurrentState(command) {
        let python = (0, child_process_1.spawn)((0, path_1.join)(__dirname, '/venv/bin/python3'), [(0, path_1.join)(__dirname, '../main.py'), this.username, this.password, this.spin, command, 'status', this.vin]);
        let success = false;
        let error = undefined;
        let currentState = false;
        python.stderr.on('data', (data) => {
            error = data;
            this.log("Python: " + error);
        });
        python.stdout.on('data', (data) => {
            let parsed = JSON.parse(data);
            if (command == 'climatisation') {
                currentState = parsed.cabinHeating;
            }
            else if (command == 'locked') {
                currentState = parsed.locked;
            }
            success = true;
        });
        return (0, timeoutPromise_1.default)(new Promise((resolve, reject) => {
            python.on('close', (code) => {
                if (success) {
                    resolve(currentState);
                }
                else {
                    reject(new Error(error));
                }
            });
        }), 10000, new Error(`Timed out getting state of ${command}`));
    }
    /*
     * This method is called directly after creation of this instance.
     * It should return all services which should be added to the accessory.
     */
    getServices() {
        return [
            this.informationService,
            this.lockService,
            this.climatisationService
        ];
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerAccessory("homebridge-vw", "WeConnect", WeConnect);
};
//# sourceMappingURL=plugin.js.map