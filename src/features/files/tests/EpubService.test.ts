import { Effect } from "effect";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { EpubService } from "#/features/files/services/EpubService";
import { FileService } from "#/features/files/services/FileService";
import { runTest } from "#/shared/test/helpers";

// 1x1 transparent PNG.
const PNG_BYTES = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>The Test Title</dc:title>
    <dc:creator>Jane Doe</dc:creator>
    <dc:creator>John Smith</dc:creator>
    <dc:publisher>Test House</dc:publisher>
    <dc:language>en</dc:language>
    <dc:subject>fiction</dc:subject>
    <dc:subject>adventure</dc:subject>
    <dc:description>A short description.</dc:description>
    <dc:date>2021-05-01</dc:date>
    <dc:identifier id="bookid" opf:scheme="ISBN">9781234567897</dc:identifier>
    <meta property="belongs-to-collection" id="c01">Test Series</meta>
    <meta refines="#c01" property="group-position">2</meta>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
</package>`;

const buildEpub = () =>
	zipSync({
		mimetype: new TextEncoder().encode("application/epub+zip"),
		"META-INF/container.xml": new TextEncoder().encode(CONTAINER_XML),
		"content.opf": new TextEncoder().encode(CONTENT_OPF),
		"cover.png": PNG_BYTES,
	});

describe("EpubService", () => {
	it("parses metadata and extracts the cover from an EPUB stored in R2", async () => {
		const r2Key = "books/sample.epub";
		const epub = buildEpub();

		const result = await runTest(
			Effect.gen(function* () {
				yield* FileService.uploadBookFile({ r2Key, body: epub });
				return yield* EpubService.parseEpubMetadataAndCoverFromR2({ r2Key });
			}),
		);

		const { metadata, cover } = result;
		expect(metadata.title).toBe("The Test Title");
		expect(metadata.authors).toEqual(["Jane Doe", "John Smith"]);
		expect(metadata.publisher).toBe("Test House");
		expect(metadata.language).toBe("en");
		expect(metadata.tags).toEqual(["fiction", "adventure"]);
		expect(metadata.description).toBe("A short description.");
		expect(metadata.pubdate).toBe("2021-05-01");
		expect(metadata.series).toBe("Test Series");
		expect(metadata.seriesIndex).toBe(2);
		expect(metadata.identifiers).toEqual([
			{ type: "isbn", value: "9781234567897" },
		]);

		expect(cover?.mimeType).toBe("image/png");
		expect(cover?.data).toEqual(PNG_BYTES);
	});
});
