"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const http_1 = __importDefault(require("http"));
const PLUGIN_NAME = "homebridge-vw";
const PLATFORM_NAME = "WeConnect";
let hap;
let Accessory;
class WeConnect {
    constructor(log, config, api) {
        this.accessories = [];
        this.log = log;
        this.api = api;
        // probably parse config or something here
        log.info("Example platform finished initializing!");
        /*
         * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
         * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
         * after this event was fired, in order to ensure they weren't added to homebridge already.
         * This event can also be used to start discovery of new accessories.
         */
        api.on("didFinishLaunching" /* APIEvent.DID_FINISH_LAUNCHING */, () => {
            log.info("Example platform 'didFinishLaunching'");
            // The idea of this plugin is that we open a http service which exposes api calls to add or remove accessories
            this.createHttpService();
        });
    }
    /*
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory) {
        this.log("Configuring accessory %s", accessory.displayName);
        accessory.on("identify" /* PlatformAccessoryEvent.IDENTIFY */, () => {
            this.log("%s identified!", accessory.displayName);
        });
        accessory.getService(hap.Service.Lightbulb).getCharacteristic(hap.Characteristic.On)
            .on("set" /* CharacteristicEventTypes.SET */, (value, callback) => {
            this.log.info("%s Light was set to: " + value);
            callback();
        });
        this.accessories.push(accessory);
    }
    // --------------------------- CUSTOM METHODS ---------------------------
    addAccessory(name) {
        this.log.info("Adding new accessory with name %s", name);
        // uuid must be generated from a unique but not changing data source, name should not be used in the most cases. But works in this specific example.
        const uuid = hap.uuid.generate(name);
        const accessory = new Accessory(name, uuid);
        accessory.addService(hap.Service.Lightbulb, "Test Light");
        this.configureAccessory(accessory); // abusing the configureAccessory here
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
    removeAccessories() {
        // we don't have any special identifiers, we just remove all our accessories
        this.log.info("Removing all accessories");
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, this.accessories);
        this.accessories.splice(0, this.accessories.length); // clear out the array
    }
    createHttpService() {
        this.requestServer = http_1.default.createServer(this.handleRequest.bind(this));
        this.requestServer.listen(18081, () => this.log.info("Http server listening on 18081..."));
    }
    handleRequest(request, response) {
        if (request.url === "/add") {
            this.addAccessory(new Date().toISOString());
        }
        else if (request.url === "/remove") {
            this.removeAccessories();
        }
        response.writeHead(204); // 204 No content
        response.end();
    }
}
module.exports = (api) => {
    hap = api.hap;
    Accessory = api.platformAccessory;
    api.registerPlatform(PLATFORM_NAME, WeConnect);
};
//# sourceMappingURL=plugin-new.js.map