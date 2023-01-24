"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const timeoutPromise_1 = __importDefault(require("./timeoutPromise"));
const path_1 = require("path");
const child_process_1 = require("child_process");
let hap;
class Climatisation {
    constructor(log, config, api) {
        this.lastRequest = undefined;
        this.climatisationOn = false;
        this.log = log;
        this.name = config.name;
        this.config = config;
        this.username = config['username'];
        this.password = config['password'];
        this.spin = config['spin'];
        this.lastRequest = new Date();
        this.fanService = new hap.Service.Fan(this.name);
        this.fanService.getCharacteristic(hap.Characteristic.On)
            .on("get" /* CharacteristicEventTypes.GET */, (callback) => {
            this.log("Get climatisation state");
            if (this.lastRequest != undefined) {
                var now = new Date();
                var duration = (now.valueOf() - this.lastRequest.valueOf()) / 10000;
                if (duration < 30) {
                    return callback(null, this.climatisationOn);
                }
                this.log("duration: " + duration);
            }
            this.lastRequest = new Date();
            try {
                this.getCurrentState('cabin-heating').then((on) => {
                    this.climatisationOn = on;
                    log.info("Climatisation " + (this.climatisationOn ? "ON" : "OFF"));
                    callback(null, this.climatisationOn);
                }, (err) => {
                    this.log.error("Error: " + err.message);
                    callback();
                });
            }
            catch (error) {
                this.log.error("Error: " + error);
                callback();
            }
        })
            .on("set" /* CharacteristicEventTypes.SET */, (value, callback) => {
            this.log(`Set climatisation state ${value}`);
            try {
                this.setCurrentState('cabin-heating', value == true ? '1' : '0').then(() => {
                    this.climatisationOn = (value == "1");
                    log("Climatisation: " + (this.climatisationOn ? "ON" : "OFF"));
                    callback(null);
                }, (err) => {
                    this.log.error("Error: " + err.message);
                    callback();
                });
            }
            catch (error) {
                this.log.error("Error: " + error);
                callback();
            }
        });
        this.informationService = new hap.Service.AccessoryInformation()
            .setCharacteristic(hap.Characteristic.Manufacturer, config.manufacturer)
            .setCharacteristic(hap.Characteristic.Model, config.model);
        this.log("Climatisation finished initializing!");
    }
    /*
     * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
     * Typical this only ever happens at the pairing process.
     */
    identify() {
        this.log("Identify!");
    }
    async setCurrentState(command, value) {
        let python = (0, child_process_1.spawn)((0, path_1.join)(__dirname, '/venv/bin/python3'), [(0, path_1.join)(__dirname, '../main.py'), this.username, this.password, this.spin, command, value]);
        let error = null;
        let success = false;
        python.stderr.on('data', (data) => {
            error = data;
            this.log("Error: " + error);
        });
        python.stdout.on('data', (data) => {
            this.log("DATA: " + data.toString());
            let parsed = JSON.parse(data);
            success = parsed.currentState == value;
        });
        return (0, timeoutPromise_1.default)(new Promise((resolve, reject) => {
            python.on('close', (code) => {
                if (success) {
                    resolve();
                }
                else {
                    reject(error);
                }
            });
        }), 10000, new Error(`Timed out setting state of ${command} to ${value}`));
    }
    async getCurrentState(command) {
        let python = (0, child_process_1.spawn)((0, path_1.join)(__dirname, '/venv/bin/python3'), [(0, path_1.join)(__dirname, '../main.py'), this.username, this.password, this.spin, command, 'status']);
        let error = null;
        let currentState = false;
        python.stderr.on('data', (data) => {
            error = data;
            this.log("Error: " + error);
        });
        python.stdout.on('data', (data) => {
            this.log("DATA: " + data.toString());
            let parsed = JSON.parse(data);
            if (command == 'cabin-heating') {
                currentState = parsed.cabinHeating;
            }
            else if (command == 'locked') {
                currentState = parsed.locked;
            }
        });
        return (0, timeoutPromise_1.default)(new Promise((resolve, reject) => {
            python.on('close', (code) => {
                if (error) {
                    reject(error);
                }
                else {
                    resolve(currentState);
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
            this.fanService,
        ];
    }
}
module.exports = (api) => {
    hap = api.hap;
    api.registerAccessory("homebridge-vw", "Climatisation", Climatisation);
};
//# sourceMappingURL=plugin.js.map