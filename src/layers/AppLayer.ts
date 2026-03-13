import { Layer } from "effect";
import { ConverterContainerLive } from "#/layers/ConverterContainerLayer";
import { DatabaseLive } from "#/layers/DatabaseLayer";
import { R2Live } from "#/layers/R2Layer";

export const AppLayer = Layer.mergeAll(DatabaseLive, R2Live);

/** Extended layer that includes the Converter Container — used by the queue handler */
export const AppLayerWithContainer = Layer.mergeAll(
	DatabaseLive,
	R2Live,
	ConverterContainerLive,
);
