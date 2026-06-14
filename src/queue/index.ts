import { handleMetadataQueue } from "#/features/books/queue/metadata";
import { handleConversionQueue } from "#/features/conversion/queue/conversion";

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
