import server from "@tanstack/react-start/server-entry";
import { handleConversionQueue } from "#/queue";

export { ConverterContainer } from "#/containers/converter";

export default {
	fetch: server.fetch,
	queue: handleConversionQueue,
};
