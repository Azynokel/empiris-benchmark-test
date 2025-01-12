import { nodeDependency } from "./node";
import { goDependency } from "./go";
import { makeDependency } from "./make";
import { k6Dependency } from "./k6";

export const dependencies = [nodeDependency, goDependency, makeDependency];

export function getDependency(name: "go" | "node" | "make" | "k6") {
  if (name === "go") {
    return goDependency;
  } else if (name === "node") {
    return nodeDependency;
  } else if (name === "k6") {
    return k6Dependency;
  }
  return makeDependency;
}
