import "@tanstack/react-start/server-only";

import { Layer } from "effect";
import { AutocompleteService } from "#/features/books/services/AutocompleteService";
import { BookService } from "#/features/books/services/BookService";
import { ConversionService } from "#/features/conversion/services/ConversionService";
import { EpubService } from "#/features/files/services/EpubService";
import { FileService } from "#/features/files/services/FileService";
import { KoboService } from "#/features/kobo/services/KoboService";
import { ShelfService } from "#/features/shelves/services/ShelfService";
import { ConverterContainerLive } from "#/shared/layers/ConverterContainerLayer";
import { DatabaseLive } from "#/shared/layers/DatabaseLayer";
import { R2Live } from "#/shared/layers/R2Layer";

// `DatabaseLive` / `R2Live` stay in the merge because a few boundaries still
// reach for `DatabaseContext` directly. Services declare the same layer objects
// as dependencies, so identity memoization keeps one instance of each.
export const AppLayer = Layer.mergeAll(
	DatabaseLive,
	R2Live,
	FileService.Default,
	EpubService.Default,
	BookService.Default,
	AutocompleteService.Default,
	ConversionService.Default,
	KoboService.Default,
	ShelfService.Default,
);

/** Extended layer that includes the Converter Container — used by the queue handler */
export const AppLayerWithContainer = Layer.merge(
	AppLayer,
	ConverterContainerLive,
);

/**
 * Everything `ServerRuntime` can provide. Boundaries that accept a caller's
 * Effect should require this rather than naming individual tags, so adding a
 * service does not ripple into every handler signature.
 */
export type AppServices = Layer.Layer.Success<typeof AppLayer>;
