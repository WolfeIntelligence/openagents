# Dataset Profiler

## 0. Do not clean anything yet

Profiling and cleaning are separate steps and mixing them loses information. First find
out what is there. Cleaning decisions come after, and each one gets written down.

## 1. Shape and provenance

- Row count, column count, file size.
- Where did this come from, and when? An export has a timestamp and a filter behind it.
- Is this the whole population or a sample? If a sample, sampled how? This determines
  what you are allowed to conclude.
- One row is one what? State it explicitly. Half of all data confusion is an unclear
  grain.

## 2. Per column: what is actually in there

For every column, regardless of its declared type:

- Declared type versus actual content. A numeric column read as text usually has one
  bad value, and finding it is the whole task.
- Null count and null rate. Also count the nulls in disguise: empty string, `"NA"`,
  `"null"`, `"-"`, `0` where zero is impossible, `1970-01-01`, `9999`.
- Distinct count. Equal to the row count means it is an identifier. Very low means it is
  a category, whatever its type.
- For numerics: min, max, mean, median, and the 1st and 99th percentiles. A mean far
  from the median means skew or outliers.
- For text: length range, and the 10 most frequent values. Look for the same category
  spelled several ways.
- For dates: min, max, and whether any fall in the future.

## 3. Missingness is data

Do not just count nulls, ask whether they are random.

- Group the null rate by other columns. Nulls concentrated in one segment, one date
  range, or one source system are a structural fact, not noise.
- A column that is null before a certain date means the field was added then. Any trend
  across that boundary is an artifact.
- Never fill a null without saying why. Filling with the mean invents data and shrinks
  variance. It is sometimes right, and always a decision to record.

## 4. Duplicates

- Exact duplicate rows: count them.
- Duplicates on what should be the key: these are the dangerous ones, and they silently
  double every join.
- Near-duplicates: same entity, different spelling or whitespace or case.

Before removing any, work out why they exist. An export run twice and a genuine repeated
event look identical and mean opposite things.

## 5. Outliers and impossibilities

Separate these two. An outlier is surprising but possible. An impossibility is a bug.

- Impossible: negative ages, future birthdates, percentages above 100, end before
  start, a total that is less than one of its parts.
- Outliers: values beyond the 1st or 99th percentile. Look at the actual rows. Do not
  remove them because they are inconvenient.

Impossible values mean the pipeline is broken and everything derived from that column
is suspect.

## 6. Report what the data cannot answer

The most useful section. Be specific:

- Questions that need a column that is absent.
- Questions that need a grain finer than one row.
- Questions ruled out by the sampling, the date range, or a systematic gap.
- Comparisons broken by a definition change partway through.

If a `target` question was given, answer explicitly whether this dataset can answer it,
and say what would be needed if not.

## Output

Report the shape, a per-column table, the missingness findings, the duplicates, the
impossibilities, and the limits. Then list every cleaning decision you propose with its
reason, and apply none of them until that list is agreed.
