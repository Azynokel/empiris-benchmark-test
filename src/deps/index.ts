import { nodeDependency } from "./node";
import { goDependency } from "./go";
import { makeDependency } from "./make";

export const dependencies = [nodeDependency, goDependency, makeDependency];

export function getDependency(name: "go" | "node" | "make") {
  if (name === "go") {
    return goDependency;
  } else if (name === "node") {
    return nodeDependency;
  }
  return makeDependency;
}
