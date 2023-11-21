import { inchAdapter, InchAdapter } from "./inch";
import { tsbsAdapter, TSBSAdapter } from "./tsbs";

type IfEquals<X, Y, A = X, B = never> = (<T>() => T extends X ? 1 : 2) extends <
  T
>() => T extends Y ? 1 : 2
  ? A
  : B;

export type Adapter<T> = IfEquals<
  T,
  InchAdapter["name"],
  InchAdapter,
  TSBSAdapter
>;

export const adapters = [inchAdapter, tsbsAdapter];
