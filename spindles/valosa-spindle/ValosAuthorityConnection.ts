import { dumpObject } from "@valos/tools";

const { AuthorityConnection } = require("@valos/sourcerer");
const { ChronicleEventResult } = require("@valos/sourcerer").api.types

export class ValosAuthorityConnection extends AuthorityConnection {
  _narrations = {};
  _preparations = {};
  _chroniclings = [];

  // Test writer API

  addNarrateResults ({ eventIdBegin }, events) {
    const narration = this._narrations[eventIdBegin] || (this._narrations[eventIdBegin] = {});
    if (narration.resultEvents) {
    const error = new Error(`narration result events already exist for ${eventIdBegin}`);
    throw this.wrapErrorEvent(error, 1,
        new Error("addNarrateResults"));
    }
    narration.resultEvents = events;
    this._tryFulfillNarration(narration);
  }

  getNarration (eventIdBegin) {
    const ret = this._narrations[eventIdBegin];
    if (!ret) {
    throw new Error(`Cannot find an existing narration request beginning from "${eventIdBegin}"`);
    }
    return ret;
  }

  addPrepareBvobResult ({ contentHash }) {
    const preparation = this._preparations[contentHash] || (this._preparations[contentHash] = {});
    if (preparation.contentHash) {
    const error = new Error(`bvob preparation result already exists for ${contentHash}`);
    throw this.wrapErrorEvent(error, 1,
        new Error("addPrepareBvobResult"));
    }
    preparation.contentHash = contentHash;
    this._tryFulfillPreparation(preparation);
  }

  getPreparation (contentHash) {
    const ret = this._preparations[contentHash];
    if (!ret) throw new Error(`Cannot find an existing prepareBvob request for "${contentHash}"`);
    return ret;
  }

  // Connection implementation
  // flow types:  (options: ?NarrateOptions = {}): Promise<any> {
  narrateEventLog (options: any): any { 
    if (!this.isRemoteAuthority()) return super.narrateEventLog(options);
    const narration = this._narrations[options.eventIdBegin || 0]
        || (this._narrations[options.eventIdBegin || 0] = {});
    narration.options = options;
    return this._tryFulfillNarration(narration) || new Promise((resolve, reject) => {
        narration.resolve = resolve;
        narration.reject = reject;
    });
  }
  // flow types:  (events: EventBase[], options: ChronicleOptions): ChronicleRequest
  chronicleEvents (events:  Array<any>, options: any): any {
    if (!this.isRemoteAuthority()) return super.chronicleEvents(events, options);
    this._mostRecentChronicleOptions = options;
    const resultBase = new ValosaEventResult(this);
    resultBase._events = events;
    resultBase.isPrimary = this.isPrimaryAuthority();
    const eventResults = events.map((event, index) => {
    const ret = Object.create(resultBase); ret.event = event; ret.index = index; return ret;
    });
    this._chroniclings.push(...eventResults);
    return { eventResults };
  }
  // flow-types: (content: any, mediaInfo: MediaInfo)
  prepareBvob (content: any, mediaInfo: any): Object | Promise<Object> {
    if (!this.isRemoteAuthority()) return super.prepareBvob(content, mediaInfo);
    const contentHash = mediaInfo && mediaInfo.contentHash;
    if (!contentHash) throw new Error("mediaInfo.contentHash not defined");
    const preparation = this._preparations[contentHash] || (this._preparations[contentHash] = {});
    preparation.content = content;
    preparation.mediaInfo = mediaInfo;
    return {
    contentHash,
    persistProcess: this._tryFulfillPreparation(preparation) || new Promise((resolve, reject) => {
        preparation.resolve = resolve;
        preparation.reject = reject;
    }),
    };
  }

  // Detail
  // flow-types:  (narration: Object)
  _tryFulfillNarration (narration: any) {
    if (!narration.options || !narration.resultEvents) return undefined;
    const ret: any = {};
    try {
    ret.testAuthorityTruths = !narration.resultEvents.length ? []
        : narration.options.receiveTruths(narration.resultEvents);
    if (narration.resolve) narration.resolve(ret);
    return ret;
    } catch (error) {
    const wrapped = this.wrapErrorEvent(error, 1, new Error("tryFulfillNarration()"),
        "\n\tnarration:", ...dumpObject(narration));
    if (!narration.reject) throw wrapped;
    narration.reject(wrapped);
    }
    return undefined;
  }
  // flow-types: (preparation: Object)
  _tryFulfillPreparation (preparation: any) {
    if (!preparation.mediaInfo || !preparation.contentHash) return undefined;
    try {
    if (preparation.resolve) preparation.resolve(preparation.contentHash);
    return preparation.contentHash;
    } catch (error) {
    const wrapped = this.wrapErrorEvent(error, 1, new Error("_tryFulfillPreparation()"),
        "\n\tnarration:", ...dumpObject(preparation));
    if (!preparation.reject) throw wrapped;
    preparation.reject(wrapped);
    }
    return undefined;
  }
}

class ValosaEventResult extends ChronicleEventResult {
  constructor(chronicler: any) {
    super(chronicler);
  }

  getComposedEvent () { return undefined; }
  getPersistedEvent () { return undefined; }
  getTruthEvent () {
    if (!this.isPrimary) {
      return Promise.reject(new Error("Non-primary authority cannot chronicle events"));
    }
    return this.truthEventProcess
        || (this.truthEventProcess = new Promise((resolve, reject) => {
          this.resolveTruthEvent = resolve;
          this.rejectTruthEvent = reject;
        }));
  }
}