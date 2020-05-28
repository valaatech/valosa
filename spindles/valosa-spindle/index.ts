import { EVENT_VERSION } from "@valos/sourcerer";
import { ValosAuthority } from './ValosAuthority'


export default function createValaaTestScheme ({ config, authorityURI }: any) {
  return {
    scheme: "valosa-scheme",

    getAuthorityURIFromChronicleURI: () => authorityURI || `valaa-test:`,

    obtainAuthorityConfig: () => ({
      eventVersion: EVENT_VERSION,
      isLocallyPersisted: true,
      isPrimaryAuthority: true,
      isRemoteAuthority: false,
      ...config,
    }),

    createAuthority: (options: Object) => new ValosAuthority(options),
  };
}