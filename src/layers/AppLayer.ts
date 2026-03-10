import { Layer } from "effect";
import { DatabaseLive } from "#/layers/DatabaseLayer";
import { R2Live } from "#/layers/R2Layer";

export const AppLayer = Layer.mergeAll(DatabaseLive, R2Live);
