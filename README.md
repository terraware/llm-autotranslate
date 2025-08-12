# Autotranslate

A utility for automated translation of strings for localizable software.

Features:

- Uses the OpenAI API to translate from the source language (default: US English)
  to the target language(s).
- Supports incremental translation of new or changed strings from files that were
  translated previously.

## Usage

The `OPENAI_API_KEY` environment variable must be set. Alternately, you can add
it to the file `.env`.

```
autotranslate [options]
```

Options:

- `--config <path>`: Optional path to the config file to use. If not specified,
  defaults to `autotranslate.json`.
- `--watch`: Run continuously, watching for modifications to the source-language
  strings file and updating the target-language files as needed. Useful in dev
  environments to automatically keep translations up to date as original strings
  are edited.
- `--verbose` or `-v`: Show details of the configuration and the progress of
  the translations. Default is to run silently unless there's an error. Verbose
  mode may also be enabled in the config file.

## Overview

Strings are defined in strings files. There is a file for the source language that
is edited by hand. Strings may be added to and removed from the source-language
strings file, or existing strings may be edited.

Each target language also has its own file. The target-language files are updated
by autotranslate. They may also be edited by hand if developers want to modify any
of the translations.

When you run autotranslate, it does the following:

1. Reads the source-language strings file.
2. Calculates the hash of each string+description in the source-language file.
3. For each of the target languages:
   1. Reads the target language's strings file, if it exists.
   2. Removes the rows for any keys that don't exist in the source-language file.
   3. If a key doesn't exist in the target-language file, OR if the hash that
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
  `src/preamble.txt`. The strings `{SOURCE_LANGUAGE}` and `{TARGET_LANGUAGE}` in
  the preamble are replaced with the names of the source and target languages.
- An optional file with project-specific, but not language-specific, instructions.
- An optional file with language-specific instructions.

The instructions are the same for each OpenAI API request. The prompt changes from
request to request and includes the text and description, properly delimited as
described in the preamble.

## Config file

The config file contains a JSON object with the following structure. Some properties
are optional as noted below.

```json
{
    "batchSize": <number>,
    "instructions": "<path>",
    "source": {
        "file": "<path>",
        "format": "<format name>",
        "language": "<language name>",
        "outputs": [
            {
                "file": "<path>"
                "format": "<format name>",
            }
        ]
    },
    "targets": [
        {
            "file": "<path>"
            "format": "<format name>",
            "instructions": "<path>",
            "language": "<language name>",
            "outputs": [
                {
                    "file": "<path>"
                    "format": "<format name>",
                }
            ]
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

`source.file` (required) is the path of the source strings file.

`source.format` (optional) is the format of the source strings file, as described
in the Formats section below. Default is `csv`.

`source.language` (optional) is the name of the source language. Default is
`English`.

`source.outputs` (optional) is a list of files in alternate formats to generate
from the source language. See "Outputs" below.

`targets` is a list of information about each target language.

`targets[].language` (required) is the English name of the language, e.g.,
`"Spanish"`.

`targets[].file` (required) is the path of the target strings file for the
language.

`targets[].format` (optional) is the format of the target strings file, as
described in the Formats section below. Default is `csv`.

`targets[].instructions` (optional) is the path of a text file with instructions
to include with translation requests for this language. For example, it can
contain a list of specific translations to use for project-specific terminology.

`targets[].outputs` (optional) is a list of files in alternate formats to generate
for the target language. See "Outputs" below.

`verbose` (optional) enables verbose logging of progress and configuration.
Verbose mode may also be enabled via command-line option.

### Formats

Strings files can have different formats, but regardless of format, they can have
the following information for each string:

- Key: A unique identifier for the string.
- Text: The text of the string in the file's language.
- Description: Optionally present in the source-langauge strings file. Additional
  information about the string to help produce better translations.
- Hash: Always present in the target-language strings file. A hash (using the
  32-bit xxHash algorithm and encoded in zero-padded lower-case hexadecimal)
  of the text and description in the source language. This is used to detect
  when the source-language text or description has been edited and autotranslate
  needs to generate fresh translations.

The main source and target files are considered the source of truth. Autotranslate
will always read and write them.

In addition, autotranslate can write strings for the source and target languages
to additional output files.

Each file specification, whether it's the main source/target file or an additional
output, has a `file` value with the path of the output file and a `format` value
that controls what kind of file is generated.

List of supported formats, each of which is described in more detail below:

- `csv`
- `java-properties`
- `javascript-const`

#### csv

CSV files have three columns. They always start with a header line. The files
use standard CSV formatting, with double quotes omitted if they aren't required.

For the source language CSV, the three columns are:

1. Key
2. Text
3. Description

For the target language CSVs, the three columns are:

1. Key
2. Text
3. Hash

#### java-properties

Produces a Java properties file for use as a PropertyResourceBundle. The keys are
the string keys and the values are the text, with special characters properly
quoted. If a string has a description, it is included in the source language's
file as a comment on the line before the key/value pair. For target-language
files, the hash is included as a comment on the line before the key/value pair.

Example (source language):

```
ABC=Some text\: it''s quoted
# Description for key DEF
DEF=Some other text
```

#### javascript-const

Produces a JavaScript source file that exports a constant `strings` that is an
object where the keys are the string keys and the values are the text. If a
string has a description, it is included as a comment on the line before the
key/value pair, but only for the source language. For target-language files,
the hash is included as a comment on the line before the key/value pair.

Example (source language):

```javascript
export const strings = {
  ABC: 'Some text',
  // Description for key DEF
  DEF: 'Some other text',
};
```
