
// TODO(sokka): Figure out any's and decide where this should actually live

declare module '@valos/sourcerer' {
    export class AuthorityConnection {
        constructor(options)
        warnEvent: Function;
        getChronicleId: Function;
        getSourcerer: Function;
        isActive: Function;
        connect: Function;
        logEvent: Function;
        asActiveConnection: Function;
        narrateEventLog: Function;
        errorEvent: Function;
        wrapErrorEvent: Function;
        chronicleEvents: Function;
        getVerbosity: Function;
        outputErrorEvent: Function;
        
        _downstreamReceiveTruths: Function;
        _isConnected: boolean;
        _enqueueDownstreamEvents: Function;
        _flushDownstreamEventsLeadingBlock: Function;
        _subscribeToMQTTEvents: Function;
        _enqueueUpstreamEvents: Function;

        _renarrationOfDownstreamEventsLeadingGap: any;


    }
    export type EventData = {}
    export type MediaInfo = {}
    export type NarrateOptions = {
        receiveTruths: any;
        eventIdBegin: any;
        isConnecting: any;
        subscribeEvents: any;
        remote: any;
        identity: any;
    }

    export type CommandEnvelope = {};
    export type AuthorityOptions = {
        authorityURI: string;
        authorityConfig: any;
        nexus: any;
    };
    export type Sourcerer = {};

    export class Authority {
        constructor(options);
        logEvent: Function;
        warnEvent: Function;
        _storageManager: any;
        _authorityConfig: any;
    }
}
