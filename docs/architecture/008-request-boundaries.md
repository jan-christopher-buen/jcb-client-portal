# ADR-008: Bounded JSON request bodies

Status: implemented. Field and collection bounds remain in the shared contracts used by API validation and the existing web forms. Transport bounds accommodate those supported values without changing product limits.

| API path family                                                                | Decoded JSON body ceiling |
| ------------------------------------------------------------------------------ | ------------------------- |
| `/api/organizations/:orgId/proposals` and descendants                          | 640 KiB                   |
| Other `/api/organizations` commands and descendants                            | 128 KiB                   |
| All other paths, including authentication and invitation inspection/acceptance | 16 KiB                    |

KiB means 1,024 bytes. Limits apply to decompressed input through Express's JSON parser, before session/database work. Authentication, Origin, CSRF and schema checks still apply after parsing. A larger transport budget does not authorize extra fields, array entries or longer field values. Arbitrary JSON whitespace/padding and unnecessarily escaped property names also consume this budget; no finite limit promises to accept unlimited alternative encodings of a valid object.

Schema audit: a proposal has at most 90,120 UTF-16 text units (title 120, three 12,000-unit fields, private notes 4,000, and 100 item descriptions of 500). Six-byte `\uXXXX` encoding requires at most 540,720 bytes for those values; bounded keys, quantities, money strings and edit revision keep the object below 560 KiB. UTF-8 requires at most three bytes per UTF-16 unit; emoji use two units. The 640 KiB ceiling includes headroom for both encodings and JSON punctuation.

Other current commands fit below 100 KiB with fully escaped values: milestone create/edit (12,120/14,120 text units including reason), change request (12,120), offer edit (14,000), deliverable create/edit (13,720 including five bounded links), handover edit (6,120 including reason), organization notes (4,120), and feedback/discussion (4,000). Small identity/invitation commands fit below 4 KiB including escaped names/passwords/emails and fixed token lengths. The 128 KiB and 16 KiB ceilings retain bounded headroom. Review these budgets when shared schemas grow.

Oversized requests return only `413` with `PAYLOAD_TOO_LARGE` and a generic message; raw bodies/parser details are not echoed or logged. The browser's existing API error handling displays this message and forms preserve failed-save input. HTTP tests exercise maximum Unicode and escaped proposal create/update, persisted later-module content, and each ceiling. No file upload or external fetching capability is introduced.
