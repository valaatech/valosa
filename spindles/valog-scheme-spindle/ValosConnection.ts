// @flow

import valosheath from "@valos/gateway-api/valosheath";

/* eslint-disable max-len */
// FIXME(iridian, 2019-01): aws-mqtt version 0.2.2 breaks when its dependency
// to aws-signature-v4 goes up from 1.2.1 to 1.3.0.
// This is caused by aws-signature-v4 stealth-fixing (?) not hashing
// its aws.createPresignedURL.payload parameter prior to 1.3.0.
// aws-mqtt hashes thay payload "" explicitly in createUrlSigner.js:11.
// aws-signature-v4 fixed/altered .payload argument semantics in 1.3.0:
// https://github.com/department-stockholm/aws-signature-v4/commit/d3625221cddb0aaef453eca802fa749af7dff159#diff-168726dbe96b3ce427e7fedce31bb0bcR25
// This now results in double-hashing.
// In our code-base this is fixed by adding a resolution 1.2.1 for
// aws-signature-v4.
// https://github.com/kmamykin/aws-mqtt/pull/16#issuecomment-450936471
// TODO(iridian, 2019-01): quick evaluation of aws-mqtt and its
// direct dependency mqtt-websocket-stream shows they're by the same
// author, not maintained since two years, a bit log-spammy and
// simple, if not outright trivial. Other mqtt options could be
// evaluated. On the other hand they do have the virtue of doing pretty
// much precisely what we need and not much more.
/* eslint-enable max-len */

import type { EventBase } from "@valos/raem";
import type {
  EventData, MediaInfo, NarrateOptions,
} from "@valos/sourcerer";

/*
type CommandEnvelope = {
  partitionId: string,
  command: Object,
  lastEventId: string
}
*/

type CommandResponse = {
  partitionId: string,
  eventId: number,
  event: Object
}
import { AuthorityConnection } from "@valos/sourcerer";
// import {

// import {
const {
  dumpObject, fetchJSON, invariantify, thenChainEagerly,
// } from "@valos/tools";
} = valosheath.require("@valos/tools");

// $FlowSupress (required module not found)

// TODO (sokka): figure out type of anys in ChronicleConfig
type ChronicleConfig = {
  credentials: {
    region: string,
    IdentityPoolId: string,
    accessKeyId: string,
    secretAccessKey: string,
  },
  rest: {
    endpoint: string;
    events: string,
    commands: any;
  },
  iot: {
    endpoint: string;
    signatureExpires: string;
    topic: string;
    maxCommandBytes: any;
  },
  isRemoteAuthority: boolean;
  rejectChronicleUpstream: Function;
  blockChronicleUpstream: any;
  fixedChronicleResponse: any;
  subscribeEvents: any;
}

type EventEnvelope = {
  partitionId: string,
  eventId: number,
  event: EventData,
}

export const chronicleFailureFlags = {
  unconnected: { isSchismatic: false, proceed: { when: "connected" } },

  // Information responses
  // Ignore the response
  section100: { isSchismatic: false },

  // Successful responses
  // Non-schismatic, persisted truth by default
  section200: { isSchismatic: false, isPersisted: true, isTruth: true },
  // chronicle request was successfully persisted but not confirmed as truth
  202: { isTruth: false },

  // Redirection messages
  // Not implemented.
  section300: {
    isSchismatic: true, isRevisable: false, isReformable: false, isRefabricateable: false,
  },

  // Client error responses
  section400: {
    isSchismatic: true, isRevisable: false, isReformable: false, isRefabricateable: false,
  },
  // bad request, gateway can't recover
  400: { isSchismatic: false, proceed: { when: "narrated" } },
  // not authenticated
  401: { isSchismatic: false, proceed: { when: "authenticated" } },
  // not authorized, gateway can't recover
  403: {},
  // method not available, slim chance of recovery by hammering
  404: { isRevisable: true, proceed: { when: "staggered", times: 5, backoff: 10000 } },
  // method not allowed, gateway can't recover
  405: {},
  // log index conflict
  409: { isRevisable: true, proceed: { when: "narrated" } },
  // precondition not met
  412: { isReformable: true },

  // Server error responses
  // Limited retries
  section500: {
    isSchismatic: true, isRevisable: true,
    proceed: { when: "staggered", times: 3, backoff: 1000 },
  }
};


export default class ValosConnection extends AuthorityConnection {
  _chronicleConfig: ChronicleConfig;
  _lastEventId = 0;
  _firstPendingDownstreamLogIndex = 0;
  _pendingDownstreamEvents = [];
  _ready = false;

  constructor (options: any) {
    super(options);
    if (!this._downstreamReceiveTruths) {
      this.warnEvent("ValosConnection created without a receiveTruths callback.");
      this._downstreamReceiveTruths = (events: Object[]) => {
        this.warnEvent("Events received to a no-op _downstreamReceiveTruths",
            "\n\tevents:", ...dumpObject(events));
      };
    }
  }

  // TODO(ikajaste): This might not be needed, but it feels like it might be useful later
  // Check whether initial sync is done, and IoT is connected to receive events
  isReady () {
    return this._ready;
  }

  // Check whether MQTT client is connected to IoT
  isConnected () {
    // TODO(ikajaste): It's possible this actually returns true, make sure later
    return this._isConnected;
  }

  disconnect () {
    this._isConnected = false;
  }

  getPartitionRawId () {
    // For authorities up to version 0.3 all uuid v4 format chronicles
    // are accessed using old-style non-vpath form.
    const id = this.getChronicleId();
    return ((id.length === 44) && id.startsWith("@$~u4.")) ? id.slice(6, -2) : id;
  }
  // flow-types    (async _doConnect (options: ConnectOptions = {}))
  async _doConnect (options: any) {
    if (!this._chronicleConfig) {
      this._chronicleConfig = await this.getSourcerer()._obtainChronicleConfig(this);
    }
    if (options.subscribeEvents !== false) {
      this._subscribeToMQTTEvents();
    }
    if (options.narrateOptions !== false) {
      await this.narrateEventLog({ ...(options.narrateOptions || {}), isConnecting: true });
    }
    this._ready = true;
  }

  // Fetches recent events from upstream chronicle and delivers them to
  // the EventEnvelope unpacker, then ultimately as Events to the
  // callback funcion.
  // Returns count of events.
  // Callback can also be overriden, if you need to get the events
  // (EventEnvelopes) directly for some reason. In that case the events
  // will be delivered directly and any internal processing
  // of the envelopes skipped.
  narrateEventLog = async (options?: NarrateOptions) => {
    const {
      receiveTruths, eventIdBegin, isConnecting, subscribeEvents, remote, identity,
      /* , lastEventId, noSnapshots */
    } = options || {};
    let previousLoopCondition;
    let lastEvaluatedKey;
    let nextChunkIndex = 0;
    /* eslint-disable no-loop-func */
    let fetchURI;
    try {
      if (!this._chronicleConfig.isRemoteAuthority) {
        return super.narrateEventLog(options);
      }
      if (!isConnecting && !this.isActive()) await this.connect({ narrateOptions: false });
      if (subscribeEvents === true) this._subscribeToMQTTEvents();
      if ((subscribeEvents === false) && this.isConnected()) await this.disconnect();
      if (eventIdBegin !== undefined) {
        this._firstPendingDownstreamLogIndex = eventIdBegin;
        this._pendingDownstreamEvents = [];
      }

      // fetches the events
      const ret: any = {};
      if (remote === false) return ret;

      const identities = this._createIdentities(identity);

      const identityQueryStringParam = !(identities || []).length ? ""
          : `&authorizationIdentities=${encodeURIComponent(JSON.stringify(identities))}`;
      let delayedEnvelopes = [];
      lastEvaluatedKey = (eventIdBegin || 0) - 1;
      for (;;) {
        let requestJSONProcess;
        fetchURI = `${this._chronicleConfig.rest.events
            }?partitionId=${this.getPartitionRawId()
            }&lastEvaluatedKey=${lastEvaluatedKey
            }${identityQueryStringParam}`;
        if (lastEvaluatedKey !== undefined) {
          this.logEvent(2, () => ["GET:", fetchURI]);
          requestJSONProcess = fetchJSON(fetchURI, { method: "GET", mode: "cors" });
        }

        if (delayedEnvelopes.length) {
          this._enqueueDownstreamEvents(delayedEnvelopes, "paginated narrate");
          ret[`remoteLogChunk${nextChunkIndex++}`] =
              this._flushDownstreamEventsLeadingBlock(receiveTruths);
          delayedEnvelopes = undefined;
          if (!requestJSONProcess) break; // This was the last chunk of a paginated narration.
        }

        const responseJSON = await requestJSONProcess;
        this.logEvent(2, () => ["\tGET success:", fetchURI]);

        delayedEnvelopes = responseJSON.Items || [];
        if (responseJSON.LastEvaluatedKey !== undefined) {
          // The result has been paginated, need to fetch more
          this.logEvent(2, () => [
            "Fetching more, last event was:", responseJSON.LastEvaluatedKey.eventId,
          ]);
          lastEvaluatedKey = responseJSON.LastEvaluatedKey.eventId;
          if (lastEvaluatedKey === previousLoopCondition) {
            this.errorEvent("INTERNAL ERROR: pagination repeats the same query:", fetchURI);
            throw new Error("Paginated event fetching seems to be repeating the same query.");
          }
          previousLoopCondition = lastEvaluatedKey;
        } else if (nextChunkIndex) {
          // Last chunk of a paginated narration. Loop once more
          // without fetching to receive the last events.
          lastEvaluatedKey = undefined;
        } else {
           // Single-chunk request, receive and break.
          ret.remoteLog = [];
          if (delayedEnvelopes.length) {
            this._enqueueDownstreamEvents(delayedEnvelopes, "single-chunk narrate");
            ret.remoteLog = this._flushDownstreamEventsLeadingBlock(receiveTruths);
          }
          break;
        }
      }
      for (const [key, value] of Object.entries(ret)) ret[key] = await value;
      return ret;
    } catch (error) {
      this.warnEvent(2, () => [
        "\tGET FAILURE:", (error.response || {}).status || error.message, ":", fetchURI,
      ]);
      // todo(ikajaste): Maybe retry here?
      throw this.wrapErrorEvent(error,  new Error("narrateEventLog()"),
          "\n\tnextChunkIndex:", nextChunkIndex,
          "\n\tlastEvaluatedKey:", lastEvaluatedKey,
          "\n\terror response:", error.response);
    }
  }

  // Sends a given command within a command envelope to the API endpoint
  //flow-types:           (events: EventBase[], options: ChronicleOptions = {}) 
  chronicleEvents = async (events: EventBase[], options: any) => {
    return thenChainEagerly(this.asActiveConnection(), () => {
      if (!this._chronicleConfig.isRemoteAuthority) {
        throw new Error(`Can't chronicle events to a non-remote chronicle.`);
      }
      if (this._chronicleConfig.rejectChronicleUpstream) {
        throw new Error(`Won't chronicle events due to partititionConfig.rejectChronicleEvents: ${
            this._chronicleConfig.rejectChronicleUpstream}`);
      }
      const identities = this._createIdentities(options.identity);
      return super.chronicleEvents(events, {
        ...options,
        remoteEventsProcess: this._enqueueUpstreamEvents(events, identities),
      });
    }, function errorOnAWSChronicleEvents (error) {
      throw this.wrapErrorEvent(error, new Error("chronicleEvents"));
    }.bind(this));
  }

  _createIdentities (identity: any) {
    const ret = [];
    ((identity && identity.list()) || []).forEach(identityChronicleURI => {
      const candidate = identity.get(identityChronicleURI);
      if (candidate.authority === this.getSourcerer()) {
        const identityConfig = { ...candidate };
        delete identityConfig.authority;
        ret.push([identityChronicleURI, identityConfig]);
      }
    });
    return ret;
  }


  // Note: Requests a partition wipe! Use with caution!
  async sendChronicleDeleteCommand (test: boolean = false) {
    await this.asActiveConnection();
    if (!this._chronicleConfig.isRemoteAuthority) {
      throw new Error(
          `Can't sendChronicleDeleteCommand through a non-remote authority chronicle connection.`);
    }

    let targetURL;
    let method;
    if (!test) {
      // This is the correct implementation always, but for some reason
      // the reqwest library, or something, fails at OPTIONS cors pre-flight,
      // when called from jest, when making it before a DELETE request. Yeah, weird.
      targetURL = `${this._chronicleConfig.rest.events}?partitionId=${
          this.getPartitionRawId()}`;
      method = "DELETE";
    } else {
      // ... so when doing tests, we use an alternate method as a workaround
      targetURL = `${this._chronicleConfig.rest.endpoint}/deletepartition?partitionId=${
          this.getPartitionRawId()}`;
      method = "GET";
    }

    this.logEvent(`DEBUG: Requesting deletion for chronicle "${this.getPartitionRawId()}" from ${
        targetURL}`);
    try {
      const response = await fetchJSON(targetURL, {
        method, mode: "cors",
        // timeout: 14000,
      });
      if (response !== true) { // "true" is interpreted into a boolean
        this.errorEvent(`Probably failed to delete chronicle ${this.getPartitionRawId()}`);
        this.errorEvent(`Expected true as response, got: "${response}"`);
        throw new Error("Probably failed to delete chronicle - wrong response");
      }
      return response;
    } catch (error) {
      this.errorEvent(`Failed to delete chronicle ${this.getPartitionRawId()}`);
      this.errorEvent(`HTTP Request failed, returning: "${error.response}"`);
      throw error;
    }
  }

  requestMediaContents (mediaInfos: MediaInfo[]): any {
    return this.getSourcerer()._storageManager.downloadBvobContents(mediaInfos);
  }
  // flowtypes: (content: ArrayBuffer | () => Promise<ArrayBuffer>, mediaInfo?: MediaInfo)
  prepareBvob (content: ArrayBuffer | any, mediaInfo?: any) {
      //{ contentId: string, persistProcess: string | ?Promise<string> } {
    const whileTrying = (mediaInfo && (typeof mediaInfo.name !== "string"))
        ? `while trying to prepare media '${mediaInfo.name}' content for persist`
        : "while trying to prepare unnamed media content for persist";
    try {
      if (!mediaInfo) throw new Error(`mediaInfo missing ${whileTrying}`);
      const contentHash = mediaInfo.contentHash || mediaInfo.bvobId;
      if (!contentHash) {
        throw new Error(`bvobId missing ${whileTrying}`);
      }
      return {
        contentId: contentHash,
        persistProcess: this.getSourcerer()._storageManager
            .uploadBvobContent(content, contentHash, mediaInfo.name),
      };
    } catch (error) {
      throw this.wrapErrorEvent(error, `prepareBvob(${whileTrying})`,
          "\n\tcontent:", ...dumpObject(content),
          "\n\tmediaInfo:", mediaInfo,
      );
    }
  }

  // Upstream events section

  _upstreamEvents: Array<any> = [];

  _enqueueUpstreamEvents =  (events: Array<any>, identities: Array<any>) => {
    return events.map(event => {
      const queueEntry: any = { envelope: {
        command: event,
        partitionList: [{
          partitionId: this.getPartitionRawId(),
          lastEventId: event.aspects.log.index - 1,
        }],
        identities,
      } };
      this._upstreamEvents.push(queueEntry);
      return (queueEntry.persistProcess = this._persistUpstreamQueueEntry(queueEntry));
    });
  }

  async _persistUpstreamQueueEntry (queueEntry: any) {
    let responseJSON: Array<CommandResponse>;
    /* eslint-disable no-loop-func */
    const commandEndpoint = this._chronicleConfig.rest.commands;
    try {
      const fixedResponse = this._chronicleConfig.blockChronicleUpstream
          ? { status: 100 }
          : this._chronicleConfig.fixedChronicleResponse;
      const commandJSON = JSON.stringify(
          await this.getSourcerer().applyMiddleware(queueEntry.envelope));
      if (fixedResponse) {
        this.warnEvent(1, () => [
          `Blocking event #${queueEntry.envelope.command.aspects.log.index} with:`, fixedResponse,
          "actions:", (queueEntry.envelope.command.actions || {}).length,
          "chars:", commandJSON.length,
          ...(this.getVerbosity() < 2 ? [] : [
            "\n\tcommand.aspects:", JSON.stringify(queueEntry.envelope.command.aspects),
          ]),
          ...(this.getVerbosity() < 3 ? [] : ["\n\tcommandJSON:", commandJSON]),
        ]);
        const error: any = new Error(`Blocking event chronicle with fixed response: ${
          JSON.stringify(fixedResponse)}`);
        error.response = { ...fixedResponse };
        throw error;
      }
      if ((typeof this._chronicleConfig.iot.maxCommandBytes === "number")
          && commandJSON.length > this._chronicleConfig.iot.maxCommandBytes) {
        throw new Error(`Command too large to send. IoT limit is ${
            this._chronicleConfig.iot.maxCommandBytes} bytes.`);
      }
      const index = this._upstreamEvents.indexOf(queueEntry);
      if (index > 0) {
        try {
          await this._upstreamEvents[index - 1].persistProcess;
        } catch (error) {
          this.logEvent(1, () => [
            "Ate failure from previous upstream event persist process:",
            "\n\terror:", error.message,
          ]);
        }
      }
      if (!queueEntry.responseJSON) {
        if (this._upstreamEvents[0] !== queueEntry) {
          throw new Error("persistCommand uploadQueue was flushed before sending command envelope");
        }
        this.logEvent(2, () => [
          `PUT command #${queueEntry.envelope.command.aspects.log.index}:`, commandEndpoint,
          `{ "body": <${commandJSON.length} chars> }`,
        ]);
        /*
        if (this._upstreamEvents.length > 1) {
// TODO(iridian, 2020-01): Implement multi-command requests by
// combining all pending upstream events together and upon completion
// splitting the results back to each envelope responseJSON fields.
        }
        */
        queueEntry.responseJSON = await fetchJSON(commandEndpoint, {
          method: "PUT", mode: "cors",
          headers: { "Content-Type": "application/json" },
          // silent: true,
          body: commandJSON,
        });
        if (this._upstreamEvents[0] !== queueEntry) {
          throw new Error(
              "persistCommand fetch (strangely) succeeded while uploadQueue had been flushed");
        }
      }
      for (const { partitionId, eventId } of queueEntry.responseJSON) {
        // TODO(iridian, 2019-01): Refactor. This API was created to
        // support multi-chronicle commands, but as it stands such
        // commands are split into single-chronicle commands by
        // FalseProphet (with no transaction consistency guarantees by
        // default atm). Either make the API shamelessly
        // single-chronicle or implement a same-authority
        // multi-chronicle transactionality convergence support on
        // valaa-aws plugin side.
        invariantify(partitionId === queueEntry.envelope.partitionList[0].partitionId,
            `sent partitionId differs from received partitionId`);
        invariantify(eventId === queueEntry.envelope.command.aspects.log.index,
            `inconsistent eventId, received '${eventId}' for ${partitionId}, expected '${
                queueEntry.envelope.command.aspects.log.index}' that was sent upstream`);
      }
    } catch (error) {
      const index = this._upstreamEvents.indexOf(queueEntry);
      if ((index >= 0) && (index < this._upstreamEvents.length)) {
        this._upstreamEvents.length = index;
      }
      const actualError: any = (error instanceof Error) ? error : new Error(error.response);
      let status = (error.response || {}).status;
      if (typeof status === "string") status = parseInt(status, 10);
      if (typeof status === "number" && !isNaN(status)) {
        Object.assign(actualError,
          chronicleFailureFlags[`section${Math.floor(status / 100)}00`] || {});
      } else {
        status = "unconnected";
      }
      Object.assign(actualError, chronicleFailureFlags[status] || {});
      if (!actualError.isTruth) {
        this.warnEvent(2, () => [
          `\tPUT command #${queueEntry.envelope.command.aspects.log.index} FAILURE:`, status,
        ]);
        throw this.wrapErrorEvent(actualError, `persistCommandEnvelope`,
            "\n\tqueueEntry:", ...dumpObject(queueEntry),
            "\n\tenvelope:", ...dumpObject(queueEntry.envelope),
            "\n\tcommand:", ...dumpObject(queueEntry.envelope.command),
            "\n\tresponseJSON:", ...dumpObject(responseJSON),
            "\n\tresponse status:", ...dumpObject(status),
            "\n\tresponse error:", error.response,
        );
      }
    }
    this.logEvent(2, () => [
      `\tPUT command #${queueEntry.envelope.command.aspects.log.index} success:`, commandEndpoint,
    ]);
    if (this._upstreamEvents[0] === queueEntry) this._upstreamEvents.shift();
    return queueEntry.envelope.command;
  }

  // Downstream events section

  // subscribe to topics, and set up the callbacks for receiving events
  _subscribeToMQTTEvents = (topic: string = this._chronicleConfig.iot.topic) => {
    // Connect to IoT
    if (this._chronicleConfig.subscribeEvents === false) return undefined;
    if (!this._chronicleConfig.isRemoteAuthority) {
      throw new Error(`Can't subscribe for events on a non-remote chronicle connection.`);
    }
    const connection = this;
    return thenChainEagerly(this.getSourcerer().obtainMQTTClient(), [
      (mqttClient) => new Promise((resolve, reject) => {
        connection.logEvent(2, () => [
          `MQTT connection subscribing to topic "${topic}" on endpoint <${
            connection.getSourcerer()._authorityConfig.iot.endpoint}> with client`,
          this.getSourcerer()._mqttClientId,
        ]);
        mqttClient.subscribe(topic, [], (error, granted) => {
          const rejection = error || this.getSourcerer()._disconnectReason;
          if (rejection) return reject(rejection);
          this._isConnected = true;
          connection.logEvent(2, () => [
            "MQTT connection successfully subscribed to topic:", granted,
          ]);
          return resolve(mqttClient);
        });
        mqttClient.on("message", (sourceTopic, message) => {
          if (this.getSourcerer()._disconnectReason) {
            this._isConnected = false;
          }
          if (!this._isConnected) {
            mqttClient.unsubscribe(topic);
          } else if (sourceTopic === topic) {
            connection._processIoTMessage(message);
          }
        });
      }),
    ]);
  }

  // return value: accepted or not (note: not accepted can be normal operation)
  _processIoTMessage (message: string) {
    this._enqueueDownstreamEvents([].concat(JSON.parse(message)), "push event");
    const downstreamFlushing = this._flushDownstreamEventsLeadingBlock();
    if (downstreamFlushing) {
      thenChainEagerly(downstreamFlushing, [], e =>
          this.outputErrorEvent(e, "Exception caught during push event downstream flush"));
      if (!this._pendingDownstreamEvents.length) return; // No renarration necessary.
    }
    this._renarrateDownstreamEventsLeadingGap();
  }

  // return value: accepted or not (note: not accepted can be normal operation)
  _enqueueDownstreamEvents = (envelopes: EventEnvelope[], envelopeSource: string) => {
    // todo(ikajaste): validate JSON
    for (const envelope of envelopes) {
      if (envelope == null) continue;
      if (envelope.eventId === undefined) {
        this.warnEvent(`Ignoring a '${envelopeSource}' envelope which is missing 'eventId':`,
            ...dumpObject(envelope));
        continue;
      }
      if (envelope.partitionId && (envelope.partitionId !== this.getPartitionRawId())) {
        this.warnEvent(`Skipping a '${envelopeSource}' envelope targeted at different chronicle:`,
            envelope.partitionId);
        continue;
      }
      const pendingIndex = envelope.eventId - this._firstPendingDownstreamLogIndex;
      const duplicateReason = !(pendingIndex >= 0) ? "already narrated"
          : (this._pendingDownstreamEvents[pendingIndex] !== undefined) ? "already pending in queue"
          : undefined;
      if (duplicateReason) {
        this.logEvent(1, () => [
          `Ignoring a '${envelopeSource}' envelope with event id ${envelope.eventId}: ${
            duplicateReason}.`
        ]);
      } else {
        this._pendingDownstreamEvents[pendingIndex] = envelope.event;
      }
    }
  }

  _flushDownstreamEventsLeadingBlock = (
      // flow-types receiveTruths: EventCallback = this._downstreamReceiveTruths
      receiveTruths: any = this._downstreamReceiveTruths) => {
    let count = 0;
    while (this._pendingDownstreamEvents[count]) ++count;
    if (!count) return false;
    const truths = this._pendingDownstreamEvents.splice(0, count);
    this._firstPendingDownstreamLogIndex += count;
    return receiveTruths(truths);
  }

  _renarrateDownstreamEventsLeadingGap () {
    if (!this._chronicleConfig.isRemoteAuthority
        || this._renarrationOfDownstreamEventsLeadingGap) {
      return;
    }
    /* TODO(iridian, 2020-01): Implement narrateEventLog lastEventId functionality
    let lastEventId;
    for (let i = 0; i !== this._pendingDownstreamEvents.length; ++i) {
      if (!this._pendingDownstreamEvents[i]) continue
      eventIdEnd = this._firstPendingDownstreamLogIndex + i;
      break;
    }
    */
    const renarration = this
        .narrateEventLog()
        .finally(() => {
          if (this._renarrationOfDownstreamEventsLeadingGap === renarration) {
            this._renarrationOfDownstreamEventsLeadingGap = undefined;
          }
        })
        .then(result => Object.keys(result).length
            && this._renarrateDownstreamEventsLeadingGap())
        .catch(error =>
            this.outputErrorEvent(error, "Exception caught during renarrateMissingQueueEvents"));
    this._renarrationOfDownstreamEventsLeadingGap = renarration;
  }
}
