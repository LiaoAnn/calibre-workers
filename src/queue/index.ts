import { handleConversionQueue } from "./conversion";
import { handleMetadataQueue } from "./metadata";

export type { MetadataQueueMessage } from "./metadata";

const CONVERSION_QUEUE_NAME = "calibre-conversion";
const METADATA_QUEUE_NAME = "calibre-metadata";

export const handleQueue: ExportedHandlerQueueHandler<Env> = (
	batch,
	env,
	ctx,
) => {
	switch (batch.queue) {
		case CONVERSION_QUEUE_NAME:
			return handleConversionQueue(
				batch as Parameters<typeof handleConversionQueue>[0],
				env,
				ctx,
			);
		case METADATA_QUEUE_NAME:
			return handleMetadataQueue(
				batch as Parameters<typeof handleMetadataQueue>[0],
				env,
				ctx,
			);
		default:
			throw new Error(`Unknown queue: ${batch.queue}`);
	}
};
