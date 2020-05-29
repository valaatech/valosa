import type { AuthorityOptions, Sourcerer } from "@valos/sourcerer";
import type { ValaaURI } from "@valos/raem/ValaaURI";

import valosheath from "@valos/gateway-api/valosheath";

export default valosheath.exportSpindle({
  name: "@valaatech/aws-scheme-spindle",
  schemeModules: {
    "valaa-aws": function createValaaAWSScheme ({ parent }) {
      // These requires must be kept inside create call, so that
      // Valaa.libs will have been properly loaded by the gateway.
      const naiveURI = valosheath.require("@valos/raem").naiveURI;

      const ValosAuthority = require("./ValosAuthority").default;

      return {
        scheme: "valaa-aws",

        getAuthorityURIFromChronicleURI (chronicleURI: string) {
          const parts = chronicleURI.match(naiveURI.regex);
          return `valaa-aws://${parts[naiveURI.hostPart] || ""}${parts[naiveURI.pathPart] || ""}`;
        },
        // flow-types: obtainAuthorityConfig (chronicleURI: ValaaURI, authorityPreConfig: ?AuthorityConfig):
            //?AuthorityConfig {
        obtainAuthorityConfig (chronicleURI: ValaaURI, authorityPreConfig: any): any {
          if (!authorityPreConfig) return null;
          const ret = {
            // eventVersion must be explicitly configured by each authority.
            isLocallyPersisted: true,
            isPrimaryAuthority: true,
            isRemoteAuthority: true,
            ...authorityPreConfig,
          };
          if (ret.isRemoteAuthority) {
            if (!ret.rest && authorityPreConfig.hasOwnProperty("api")) {
              parent.warn(`Legacy @valaatech/aws authority config encountered for chronicle <${
                  chronicleURI}>: contains 'api' section instead of 'rest':`, authorityPreConfig,
                  "\n\trewriting 'api' as 'rest'");
              ret.rest = ret.api;
              delete ret.api;
            }
            if (!ret.rest.endpoint) throw new Error(`authority preconfig is missing rest.endpoint`);
            if (!ret.rest.commands) ret.rest.commands = `${ret.rest.endpoint}/commands`;
            if (!ret.rest.events) ret.rest.events = `${ret.rest.endpoint}/events`;
          } else {
            if (ret.slaitnederc) {
              throw new Error(`@valaatech/aws-scheme-spindle with ${
                ""} authorityConfig.isRemoteAuthority=false must not have .slaitnederc section`);
            }
            ret.slaitnederc = null;
            if (ret.rest) {
              throw new Error(`@valaatech/aws-scheme-spindle with ${
                ""} authorityConfig.isRemoteAuthority=false must not have .rest section`);
            }
            ret.rest = null;
            if (ret.iot) {
              throw new Error(`@valaatech/aws-scheme-spindle with ${
                ""} authorityConfig.isRemoteAuthority=false must not have .iot section`);
            }
            ret.iot = null;
            if (ret.s3) {
              throw new Error(`@valaatech/aws-scheme-spindle with ${
                ""} authorityConfig.isRemoteAuthority=false must not have .s3 section`);
            }
            ret.s3 = null;
          }
          return ret;
        },

        createAuthority (options: AuthorityOptions): Sourcerer {
          const name = options.authorityConfig.name;
          if (options.nexus) {
            options.nexus.logEvent(
                `Connecting to authority "${name}" at <${options.authorityURI}>`);
          }
          const ret = new ValosAuthority({ name, parent, ...options });
          ret.logEvent(`Connected to authority "${name}" at <${options.authorityURI}>`);
          return ret;
        }
      };
    },
  }
});
