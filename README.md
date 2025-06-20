# Autotranslate

A utility for automated translation of strings for localizable software.

Features:

- Uses the OpenAI API to translate from the source language (default: US English)
  to the target language(s).
- Supports incremental translation of new or changed strings from files that were
  translated previously.

## Usage

The `OPENAI_API_KEY` environment variable must be set.

```
autotranslate [options]
```

Options:

- `--config <path>`: Optional path to the config file to use. If not specified,
  defaults to `autotranslate.json`.
- `--verbose` or `-v`: Show details of the configuration and the progress of
  the translations. Default is to run silently unless there's an error. Verbose
  mode may also be enabled in the config file.

## Overview

Strings are defined in CSV files. There is a CSV file for the source language that
is edited by hand. Strings may be added to and removed from the source-language CSV,
or existing strings may be edited.

Each target language also has its own CSV file. The target-language CSV files are
updated by autotranslate. They may also be edited by hand if developers want to
modify any of the translations.

The CSV files have three columns. They always start with a header line. The files
use standard CSV formatting, with double quotes omitted if they aren't required.

For the source language CSV, the three columns are:

1. Key: A unique textual identifier for the string.
2. Text: The string's value. Human-readable text in the file's language.
3. Description: Optional additional information about the string to help improve
   translations.

For the target language CSVs, the three columns are:

1. Key: The string's key from the source language CSV.
2. Text: The translation of the text from the source language CSV.
3. Hash: A hash of the text and description of the source-language version of
   the string. The hash uses the xxHash algorithm since it's only used to detect
   changes to the text and description, not for cryptographic purposes.

When you run autotranslate, it does the following:

1. Reads the source-language CSV file.
2. Calculates the hash of each string+description in the source-language file.
3. For each of the target languages:
   1. Reads the target language's CSV file, if it exists.
   2. Removes the rows for any keys that don't exist in the source-language file.
   3. If a key doesn't exist in the target-language CSV file, OR if the hash that
      was recorded in the target-language file doesn't match the current hash from
      the source-language file, generates a new translation using the OpenAI API.
   4. Writes the updated target-language file.

The above is a conceptual description; in reality, some of the operations may be
batched or done in parallel.

## Translation generation

Translations are generated using the OpenAI Responses API:

https://platform.openai.com/docs/api-reference/responses

The value of the "instructions" field in the API request is constructed from the
following pieces:

- A preamble that's built into autotranslate. The preamble is in the file
  `src/preamble.txt`. The string `{LANGUAGE}` in the preamble is replaced with
  the name of the target language.
- An optional file with project-specific, but not language-specific, instructions.
  This is specified on the command line when autotranslate is run.
- An optional file with language-specific instructions. This is specified for each
  language on the command line when autotranslate is run.

The instructions are the same for each OpenAI API request. The prompt changes from
request to request and includes the text and description, propertly delimited as
described in the instructions.

## Config file

The config file contains a JSON object with the following structure. Some properties
are optional as noted below.

```json
{
    "batchSize": <number>,
    "instructions": "<path>",
    "source": {
        "file": "<path>",
    },
    "targets": [
        {
            "language": "<language name>",
            "file": "<path>"
            "instructions": "<path>",
        }
    ],
    "verbose": <boolean>
}
```

Explanations of each of the properties, with the property names in JavaScript
notation:

`batchSize` (optional) is the number of strings to translate at a time. Default
is 15. If this is set to 1, batching is disabled. Batching is faster and cheaper
but can cause different translations to be generated.

`instructions` (optional) is the path of a text file with instructions to include
with translation requests for all languages. For example, it can include
definitions of project-specific terminology, or hints about the level of
formality to use in translations.

`source.file` (required) is the path of the source CSV file.

`targets` is a list of information about each target language.

`targets[].language` (required) is the English name of the language, e.g.,
`"Spanish"`.

`targets[].file` (required) is the path of the target CSV file for the language.

`targets[].instructions` (optional) is the path of a text file with instructions
to include with translation requests for this language. For example, it can
contain a list of specific translations to use for project-specific terminology.

`verbose` (optional) enables verbose logging of progress and configuration.
Verbose mode may also be enabled via command-line option.
