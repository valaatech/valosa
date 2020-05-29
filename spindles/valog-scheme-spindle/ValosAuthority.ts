import valosheath from "@valos/gateway-api/valosheath";

import type { Sourcerer } from "@valos/sourcerer/api/Sourcerer";

import ValosConnection from "./ValosConnection";
//import type { CommandEnvelope } from "./ValosConnection";

const inBrowser = require("@valos/gateway-api/inBrowser").default;
const AWSMqttClient = inBrowser()
    ? require("aws-mqtt/lib/BrowserClient").default
    : require("aws-mqtt/lib/NodeClient");

// eslint-disable-rule no-duplicate-imports

// import {
import { Authority, CommandEnvelope } from '@valos/sourcerer'

// import {
const {
  dumpObject, outputError, thenChainEagerly, trivialClone, valosUUID,
// } from "@valos/tools";
} = valosheath.require("@valos/tools");

export function createTestUpstream (authorityConfig: Object = {
  authorityURI: "valaa-test:",
  test: true,
  isRemoteAuthority: false,
  subscribeEvents: false,
  credentials: null,
  rest: { endpoint: null, events: null, commands: null, verifyEndPoint: null },
  iot: { endpoint: null, signatureExpires: null, topic: null },
  s3: { pendingBucketName: null, liveBucketName: null },
}) {
  const name = "Test ValosAuthority";
  return new ValosAuthority({ name, console, authorityConfig });
}

export default class ValosAuthority extends Authority {
  static ConnectionType = ValosConnection;

  _middleware: Array<Function> = [];
  _storageManager: any;
  _mqttClient: any;
  _mqttClientId: string;

  constructor (options:
//flow{ name: string, upstream: Sourcerer, authorityConfig: Object, parent: Object }) {
      { name: string, upstream?: Sourcerer, authorityConfig: any, parent?: any, console: any}) {
    super({ upstream: null, ...options });
    // _mqttClientId to register with MQTT broker. Need to be unique per client

    if (options.authorityConfig.isRemoteAuthority) {
      this._mqttClientId = `mqtt-client-${valosUUID()}`;
      this.logEvent(1, () => [
        `Creating upstream to '${this._authorityConfig.rest.endpoint}' with mqtt id ${
          this._mqttClientId}.`
      ]);
      //if (!ValosAuthority._storageManager) {
        // TODO(iridian, 2020-04): The heck? Why did I make this a singleton
        //ValosAuthority._storageManager = new AWSRemoteStorageManager(this, this._authorityConfig);
      //}
      //this._storageManager = ValosAuthority._storageManager;
    }
  }

  async _obtainChronicleConfig (connection: ValosConnection) {
    // TODO(ikajaste): this will eventually fetch the chronicle info
    // using this.upstreamURL. Providing endpoint directly in config is
    // a temporary shortcut during development
    const ret = trivialClone(this._authorityConfig);
    if (ret.iot) {
      ret.iot.topic = `partition/full/${connection.getPartitionRawId()}`;
      if (ret.iot.maxCommandBytes === undefined) ret.iot.maxCommandBytes = 128000;
    }
    return ret;
  }

  /**
   * Register a middleware function with the ValosAuthority. When claming
   * a command, each middleware function will get to run on the command
   * envelope.
   * @param {Function} middleware
   */
  addMiddleware (middleware: Function) {
    this._middleware.push(middleware);
  }

  /**
   * Unregister the given middleware function
   * @param {Function} middleware
   */
  removeMiddleware (middleware: Function) {
    const index = this._middleware.indexOf(middleware);
    if (index > -1) this._middleware.splice(index, 1);
  }

  /**
   * Allows each registered middleware function to modify the command
   * envelope in the order that the middlewares were registered.
   * @param {CommandEnvelope} envelope The envelope to modify
   */
  async applyMiddleware (envelope: CommandEnvelope) {
    let ret = envelope;
    for (const m of this._middleware) {
      const mutatedRet = await m(this, ret);
      if (mutatedRet && typeof mutatedRet === "object") ret = mutatedRet;
    }
    return ret;
  }

  // Check whether MQTT client is connected to IoT
  isConnected () {
    // TODO(ikajaste): It's possible this actually returns true, make sure later
    return this._mqttClient && this._mqttClient.connected;
  }

  // Connect to IoT if not connected
  obtainMQTTClient () {
    // Connect to IoT
    if (!this._authorityConfig.iot) throw new Error("authorityConfig.iot not configured");
    const sourcerer: any = this;
    const wrap = `obtainMQTTClient(${this._mqttClientId})`;
    const ret = this._mqttClient || (this._mqttClient = thenChainEagerly(
        this._authorityConfig, [
          _prepareConfig,
          _createAndConnectMQTTConnection,
          mqttClient => (sourcerer._mqttClient = mqttClient),
        ],
        function errorOnSubscribeToIoTEvents (error, stepIndex, head) {
          if (sourcerer._disconnectReason) return false; // graceful disconnect during connect.
          sourcerer._mqttClient = false;
          throw sourcerer.wrapErrorEvent(error, wrap,
              "\n\tstep head:", ...dumpObject(head),
              "\n\tsourcerer:", ...dumpObject(sourcerer));
        }
    ));
    return ret;

    function _disconnect () {
      sourcerer._ready = false;
      if (ret === sourcerer._mqttClient) sourcerer._mqttClient = false;
      return (sourcerer._disconnectReason =
          new Error(`${sourcerer.debugId()} MQTT connection disconnected`));
    }

    function _prepareConfig (config) {
      if (!config.isRemoteAuthority) {
        throw new Error(`Can't subscribe for events from a non-remote authority.`);
      }
      // TODO(Sokka): get rid of this in case we don't use this anymore
      return config;
    }

    function _createAndConnectMQTTConnection (authorityConfig) {
      const mqttClient = new AWSMqttClient({
        // WebSocket: getGlobal().WebSocket,
        //region: AWSGlobal.config.region,
        //credentials: AWSGlobal.config.credentials,
        endpoint: authorityConfig.iot.endpoint,
        expires: (authorityConfig.iot.signatureExpires !== undefined)
            ? authorityConfig.iot.signatureExpires : 600,
        clientId: sourcerer._mqttClientId,
        /*
        will: {
          topic: "WillMsg",
          payload: "Connection Closed abnormally..!",
          qos: 0,
          retain: false
        },
        */
      });
      mqttClient.setMaxListeners(1000); // TODO(iridian, 2019-06): Make configurable.

      return new Promise((resolve, reject) => {
        mqttClient.on("disconnect", () => {
          // todo(ikajaste): add a reconnect loop here
          sourcerer.logEvent(1, "MQTT connection closed by client:", sourcerer._mqttClientId);
          reject(_disconnect());
        });
        // todo(ikajaste): remove the following debug connection termination remote command
        mqttClient.on("message", (sourceTopic, message) => {
          if (message.toString() === "TERMINATE") {
            sourcerer.logEvent(1,
                "MQTT connection TERMINATE'd by client:", sourcerer._mqttClientId);
          }
        });
        mqttClient.on("connect", () => {
          sourcerer.logEvent(1, `MQTT connection to <${authorityConfig.iot.endpoint
              }> established for client:`, sourcerer._mqttClientId);
          resolve(mqttClient);
        });
        mqttClient.on("error", error => {
          // TODO(iridian): Do something more sensible than rejecting
          // the promise if this error is something that happens after
          // the connect has succeeded.
          if ((ret !== undefined) && (ret !== sourcerer._mqttClient)) {
            outputError(sourcerer.wrapErrorEvent(error, new Error(`mqttClient.on("error")`)),
                "Exception intercepted outside mqtt connection connection process");
          }
          reject(error);
        });
        // mqttClient.on("close", () => {});
        // mqttClient.on("offline", () => {});
      });
    }
  }

  // Disconnect MQTT from IoT, if connected
  _disconnectFromAuthorityMQTT () {
    if (this.isConnected()) {
      this.logEvent(1, `Closing IoT connection of client ${this._mqttClientId}`);
      this._mqttClient.end();
      // FIXME(ikajaste): Disconnect does stop events, but fails somehow - the connection remains:
      // (this._mqttClient.connected returns true)
    } else if (this._mqttClient) {
      this._mqttClient = false;
    } else {
      this.warnEvent(0,
          `Client ${this._mqttClientId} is not connected nor connecting.`);
    }
  }
}
