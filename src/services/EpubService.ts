import "@tanstack/react-start/server-only";

import { Effect } from "effect";
import { strFromU8, unzipSync } from "fflate";
import { ParseError } from "#/lib/errors";

export interface EpubMetadata {
	title?: string;
	/** Multiple authors; comma-joined for display. TODO: link to individual author profile pages */
	authors?: string[];
	description?: string;
	publisher?: string;
	tags?: string[];
	language?: string;
	pubdate?: string;
	series?: string;
	seriesIndex?: number;
	identifiers?: { type: string; value: string }[];
}

export interface EpubCover {
	data: Uint8Array;
	mimeType: string;
}

const XML_ENTITY_MAP: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

function decodeXmlEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity) => {
		if (entity.startsWith("#x")) {
			const codePoint = Number.parseInt(entity.slice(2), 16);
			return Number.isNaN(codePoint) ? _ : String.fromCodePoint(codePoint);
		}

		if (entity.startsWith("#")) {
			const codePoint = Number.parseInt(entity.slice(1), 10);
			return Number.isNaN(codePoint) ? _ : String.fromCodePoint(codePoint);
		}

		return XML_ENTITY_MAP[entity] ?? _;
	});
}

function readZipText(
	entries: Record<string, Uint8Array>,
	path: string,
): string | undefined {
	const data = entries[path] ?? entries[path.replace(/^\.\//, "")];
	return data ? strFromU8(data) : undefined;
}

function extractTagContent(xml: string, tag: string): string | undefined {
	const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const expression = new RegExp(
		`<(?:[a-zA-Z0-9_]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${escapedTag}>`,
		"i",
	);
	const matched = expression.exec(xml);
	if (!matched?.[1]) {
		return undefined;
	}

	const normalized = decodeXmlEntities(matched[1].replace(/\s+/g, " ").trim());
	return normalized.length > 0 ? normalized : undefined;
}

function extractAllTagContents(xml: string, tag: string): string[] {
	const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const expression = new RegExp(
		`<(?:[a-zA-Z0-9_]+:)?${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${escapedTag}>`,
		"gi",
	);
	const results: string[] = [];
	for (const match of xml.matchAll(expression)) {
		if (match[1]) {
			const normalized = decodeXmlEntities(
				match[1].replace(/\s+/g, " ").trim(),
			);
			if (normalized.length > 0) results.push(normalized);
		}
	}
	return results;
}

function extractIdentifiers(xml: string): { type: string; value: string }[] {
	const expression =
		/<(?:[a-zA-Z0-9_]+:)?identifier\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?identifier>/gi;
	const results: { type: string; value: string }[] = [];
	for (const match of xml.matchAll(expression)) {
		const attrs = match[1] ?? "";
		const raw = match[2] ?? "";
		const value = decodeXmlEntities(raw.replace(/\s+/g, " ").trim());
		if (!value) continue;
		// Skip UUID identifiers
		if (
			/^urn:uuid:/i.test(value) ||
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				value,
			)
		)
			continue;
		// opf:scheme or scheme attribute → use as identifier type
		const schemeMatch = /(?:opf:)?scheme\s*=\s*["']([^"']+)["']/i.exec(attrs);
		if (schemeMatch?.[1]) {
			results.push({ type: schemeMatch[1].toLowerCase(), value });
		} else {
			// urn:type:value format (e.g. urn:isbn:978...)
			const urnMatch = /^urn:([^:]+):(.+)$/i.exec(value);
			if (urnMatch?.[1] && urnMatch[2]) {
				results.push({
					type: urnMatch[1].toLowerCase(),
					value: urnMatch[2],
				});
			}
		}
	}
	return results;
}

function findOpfPath(entries: Record<string, Uint8Array>): string | undefined {
	const containerXml = readZipText(entries, "META-INF/container.xml");
	if (containerXml) {
		const match = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerXml);
		if (match?.[1] && entries[match[1]]) {
			return match[1];
		}
	}

	return Object.keys(entries).find((path) =>
		path.toLowerCase().endsWith(".opf"),
	);
}

export const parseEpubMetadata = (buffer: ArrayBuffer) =>
	Effect.try({
		try: () => {
			const entries = unzipSync(new Uint8Array(buffer));
			const opfPath = findOpfPath(entries);
			if (!opfPath) {
				return {} satisfies EpubMetadata;
			}

			const opfXml = readZipText(entries, opfPath);
			if (!opfXml) {
				return {} satisfies EpubMetadata;
			}

			const authors = extractAllTagContents(opfXml, "creator");
			const tags = extractAllTagContents(opfXml, "subject");
			const identifiers = extractIdentifiers(opfXml);

			// Calibre series: <meta name="calibre:series" content="..." />
			let series: string | undefined;
			let seriesIndex: number | undefined;
			const calibreSeriesMeta =
				/<meta\b[^>]*\bname="calibre:series"\b[^>]*>/i.exec(opfXml);
			if (calibreSeriesMeta) {
				const c = /content="([^"]+)"/.exec(calibreSeriesMeta[0]);
				if (c?.[1]) series = decodeXmlEntities(c[1]);
			}
			// EPUB 3: <meta property="belongs-to-collection">Series</meta>
			if (!series) {
				const epub3 =
					/<meta\b[^>]*\bproperty="belongs-to-collection"[^>]*>([\s\S]*?)<\/meta>/i.exec(
						opfXml,
					);
				if (epub3?.[1]) series = decodeXmlEntities(epub3[1].trim());
			}
			const calibreIndexMeta =
				/<meta\b[^>]*\bname="calibre:series_index"\b[^>]*>/i.exec(opfXml);
			if (calibreIndexMeta) {
				const c = /content="([^"]+)"/.exec(calibreIndexMeta[0]);
				if (c?.[1]) {
					const idx = Number.parseFloat(c[1]);
					if (!Number.isNaN(idx)) seriesIndex = idx;
				}
			}
			// EPUB 3: <meta property="group-position">1</meta>
			if (seriesIndex === undefined) {
				const groupPos =
					/<meta\b[^>]*\bproperty="group-position"[^>]*>([\s\S]*?)<\/meta>/i.exec(
						opfXml,
					);
				if (groupPos?.[1]) {
					const idx = Number.parseFloat(groupPos[1].trim());
					if (!Number.isNaN(idx)) seriesIndex = idx;
				}
			}

			return {
				title: extractTagContent(opfXml, "title"),
				authors: authors.length > 0 ? authors : undefined,
				description: extractTagContent(opfXml, "description"),
				publisher: extractTagContent(opfXml, "publisher"),
				tags: tags.length > 0 ? tags : undefined,
				language: extractTagContent(opfXml, "language"),
				pubdate: extractTagContent(opfXml, "date"),
				series,
				seriesIndex,
				identifiers: identifiers.length > 0 ? identifiers : undefined,
			} satisfies EpubMetadata;
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.metadata",
				cause,
			}),
	});

function getXmlAttr(tag: string, name: string): string | undefined {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
		"i",
	).exec(tag);
	return match?.[2];
}

function normalizeZipPath(path: string): string {
	const cleaned = path.replace(/\\/g, "/").replace(/^\/+/, "");
	const segments = cleaned.split("/");
	const normalized: string[] = [];

	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			normalized.pop();
			continue;
		}
		normalized.push(segment);
	}

	return normalized.join("/");
}

function resolveEntryData(
	entries: Record<string, Uint8Array>,
	opfDir: string,
	href: string,
): Uint8Array | undefined {
	const decodedHref = decodeURIComponent(href.trim());
	const candidate = normalizeZipPath(`${opfDir}${decodedHref}`);
	const noDotPrefix = candidate.replace(/^\.\//, "");

	return (
		entries[candidate] ??
		entries[noDotPrefix] ??
		entries[decodeURIComponent(candidate)]
	);
}

export const parseEpubCover = (buffer: ArrayBuffer) =>
	Effect.try({
		try: (): EpubCover | undefined => {
			const entries = unzipSync(new Uint8Array(buffer));
			const opfPath = findOpfPath(entries);
			if (!opfPath) return undefined;

			const opfXml = readZipText(entries, opfPath);
			if (!opfXml) return undefined;

			const opfDir = opfPath.includes("/")
				? opfPath.substring(0, opfPath.lastIndexOf("/") + 1)
				: "";

			let coverHref: string | undefined;
			let coverMimeType: string | undefined;
			const itemTags = opfXml.match(/<item\b[^>]*>/gi) ?? [];

			// EPUB 3: <item properties="cover-image" .../>
			const epub3Item = itemTags.find((tag) => {
				const properties = getXmlAttr(tag, "properties");
				return properties
					? properties.split(/\s+/).includes("cover-image")
					: false;
			});
			if (epub3Item) {
				coverHref = getXmlAttr(epub3Item, "href");
				coverMimeType = getXmlAttr(epub3Item, "media-type");
			}

			// EPUB 2/3: <item id="cover-image|cover" .../>
			if (!coverHref) {
				const idItem = itemTags.find((tag) => {
					const id = getXmlAttr(tag, "id")?.toLowerCase();
					return id === "cover-image" || id === "cover";
				});
				if (idItem) {
					coverHref = getXmlAttr(idItem, "href");
					coverMimeType = getXmlAttr(idItem, "media-type");
				}
			}

			// EPUB 2 fallback: <meta name="cover" content="<item-id>"/>
			if (!coverHref) {
				const metaTags = opfXml.match(/<meta\b[^>]*>/gi) ?? [];
				const coverMeta = metaTags.find(
					(tag) => getXmlAttr(tag, "name")?.toLowerCase() === "cover",
				);
				const coverId = coverMeta
					? getXmlAttr(coverMeta, "content")
					: undefined;

				if (coverId) {
					const item = itemTags.find(
						(tag) =>
							getXmlAttr(tag, "id")?.toLowerCase() === coverId.toLowerCase(),
					);
					if (item) {
						coverHref = getXmlAttr(item, "href");
						coverMimeType = getXmlAttr(item, "media-type");
					}
				}
			}

			if (!coverHref) return undefined;

			const data = resolveEntryData(entries, opfDir, coverHref);
			if (!data) return undefined;

			const normalizedHref = coverHref.toLowerCase();
			const mimeType =
				coverMimeType ??
				(normalizedHref.endsWith(".png")
					? "image/png"
					: normalizedHref.endsWith(".gif")
						? "image/gif"
						: normalizedHref.endsWith(".webp")
							? "image/webp"
							: "image/jpeg");

			return { data, mimeType };
		},
		catch: (cause) =>
			new ParseError({
				stage: "epub.cover",
				cause,
			}),
	});
