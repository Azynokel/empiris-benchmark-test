import { nodeDependency } from "./node";
import { goDependency } from "./go";

export const dependencies = [nodeDependency, goDependency];

export function getDependency(name: "go" | "node") {
  if (name === "go") {
    return goDependency;
  }
  return nodeDependency;
}
