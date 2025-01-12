import * as core from "@actions/core";
import { main } from "./main";

main()
  .catch((e) => core.setFailed(e.message))
  .then(() => process.exit(0));