## Strict File Modification Constraints

1. **NEVER use `sed`, `awk`, `perl -pi`, or any other destructive CLI text-processing tools to modify files.**
2. All file modifications (including to markdown artifacts, configuration files, and source code) MUST be done exclusively through the dedicated, non-destructive tools: `replace_file_content`, `multi_replace_file_content`, or `write_to_file`.
3. This rule applies globally to all files in all directories, with absolutely zero exceptions.
4. Do not run commands that redirect output (`>`) into the user's project directory just for the sake of reading it later. Either read the standard output directly, or put temporary outputs strictly in the designated artifact scratch directory (`<appDataDir>/brain/<conversation-id>/scratch/`).
