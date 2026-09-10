# Checks by column type

## Identifiers

- Distinct count equals row count. If not, the key is not the key.
- No nulls. A null id is a broken row.
- Consistent format. Mixed formats mean two sources merged.
- Check for leading zeros lost to a numeric read. Zip codes and account numbers are the
  usual casualties.

## Numeric

- Read as numeric, or did one bad value force text?
- Min and max physically possible?
- Zeros: real measurements, or missing values wearing a disguise?
- Negatives: possible for this quantity?
- Suspiciously round numbers in quantity suggest manual entry or a default.
- Units consistent throughout? Currency, weight and time are the usual mixed columns.

## Categorical

- Distinct values, listed. Read them.
- Same category, different spelling: case, whitespace, punctuation, abbreviation.
- A catch-all value like "Other" or "Unknown" holding a large share hides structure.
- Categories present in only part of the date range mean a taxonomy change.

## Dates and times

- Parsed as dates, or still text?
- Time zone: recorded, assumed, or mixed? Mixed is the common silent disaster.
- Any future dates? Any at the epoch, or at 1900-01-01?
- Gaps: whole days or weeks missing means a pipeline outage.
- Day-first versus month-first ambiguity: check whether any day exceeds 12.

## Text

- Length distribution. A cluster at exactly 255 means truncation upstream.
- Leading or trailing whitespace.
- Encoding damage: mojibake, replacement characters, doubled encoding.
- Embedded delimiters that may have shifted columns during a bad parse.

## Booleans

- How is it encoded? True/False, 1/0, Y/N, yes/no, or all of them in one column.
- Is null a third state with meaning, or just missing?

## Across columns

- Do totals equal the sum of their parts?
- Do dates order correctly: created before updated, start before end?
- Do foreign keys resolve? Count the orphans.
- Are mutually exclusive flags actually exclusive?
