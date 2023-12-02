import { inchAdapter, InchAdapter } from "./inch";
import { tsbsAdapter, TSBSAdapter } from "./tsbs";
import { goAdapter, GoAdapter } from "./go";
import { Config } from "../config";
import { BenchmarkAdapter } from "../types";

type IfEquals<X, Y, A = X, B = never> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? A
  : B;

type NullAdapter = BenchmarkAdapter<"null", {}>;

export type Adapter<T extends Config["benchmark"]["tool"]> = IfEquals<
  T,
  InchAdapter["tool"],
  InchAdapter,
  IfEquals<
    T,
    GoAdapter["tool"],
    GoAdapter,
    IfEquals<T, TSBSAdapter["tool"], TSBSAdapter, NullAdapter>
  >
>;

export const adapters = [inchAdapter, tsbsAdapter, goAdapter];
