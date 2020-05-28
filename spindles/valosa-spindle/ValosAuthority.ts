import { ValosAuthorityConnection } from "./ValosAuthorityConnection";
const { Authority } = require("@valos/sourcerer");

export class ValosAuthority extends Authority {
    constructor(options: any) {
        super(options);
    }
    static ConnectionType = ValosAuthorityConnection;
  
    addFollower () {
      const connectors = {};
      return connectors;
    }
}