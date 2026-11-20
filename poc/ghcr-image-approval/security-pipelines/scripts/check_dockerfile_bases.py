#!/usr/bin/env python3
"""Fail closed unless every image a Dockerfile pulls in is an approved, digest-pinned image.

Prints one `repository@sha256:...` reference per unique base image. With
--final-base-output, also writes the root base of the FINAL stage (used by the publisher to
check that the built image's layers really start with that approved base).

The Dockerfile is parsed into logical instructions first: comment lines are dropped, line
continuations (backslash, or backtick with `# escape=`` `) are joined and heredoc bodies are
skipped, so splitting an instruction over several lines does not hide it. Rejected:
  * external frontends (`# syntax=`), build-arg substitution in FROM,
  * ALL ADD instructions (including variable, URL, Git and ONBUILD forms),
  * COPY from external images, variable-expanded COPY sources, unknown instructions,
  * RUN --mount / --network / --security (they can import content or widen the sandbox).
This is still not a full BuildKit parser: keep a pinned frontend and restricted builder too.

Copy this file into the trusted central CI repository; never use an application's copy for
anything other than early PR feedback.
"""
import argparse
import pathlib
import re

APPROVED_IMAGE = (r'(?P<repo>{prefix}[a-z0-9]+(?:[._/-][a-z0-9]+)*)'
                  r'(?::[\w][\w.-]{{0,127}})?@(?P<digest>sha256:[0-9a-f]{{64}})')
DIRECTIVE = re.compile(r'^#\s*([a-zA-Z]+)\s*=\s*(\S+)\s*$')
HEREDOC = re.compile(r'<<(-?)(["\']?)([A-Za-z_][A-Za-z0-9_]*)\2')
COPY_FLAGS_OK = ('--chown=', '--chmod=', '--link', '--parents', '--exclude=')
ALLOWED_INSTRUCTIONS = {'FROM', 'ARG', 'RUN', 'COPY', 'ENV', 'LABEL', 'WORKDIR', 'USER',
                        'EXPOSE', 'VOLUME', 'STOPSIGNAL', 'CMD', 'ENTRYPOINT',
                        'HEALTHCHECK', 'SHELL'}


def logical_instructions(text):
    """Yield (first_line_number, instruction_text) with continuations joined."""
    escape = '\\'
    lines = text.splitlines()
    i, in_directives = 0, True
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if re.match(r'^#\s*syntax\s*=', stripped, re.IGNORECASE):
            raise ValueError(f'line {i + 1}: external Dockerfile frontend (# syntax=) is not permitted')
        if in_directives:
            m = DIRECTIVE.match(stripped)
            if m and m.group(1).lower() == 'escape':
                if m.group(2) not in ('\\', '`'):
                    raise ValueError(f'line {i + 1}: unsupported escape character {m.group(2)!r}')
                escape = m.group(2)
                i += 1
                continue
            if not m:
                in_directives = False
        if not stripped or stripped.startswith('#'):
            i += 1
            continue
        start = i + 1
        parts = []
        while True:
            line = lines[i].rstrip()
            if line.endswith(escape):
                parts.append(line[:-1])
                i += 1
                # Comment and empty lines inside a continuation are dropped by Docker too.
                while i < len(lines) and (not lines[i].strip() or lines[i].strip().startswith('#')):
                    if re.match(r'^#\s*syntax\s*=', lines[i].strip(), re.IGNORECASE):
                        raise ValueError(f'line {i + 1}: external Dockerfile frontend is not permitted')
                    i += 1
                if i >= len(lines):
                    break
                continue
            parts.append(line)
            i += 1
            break
        instruction = ' '.join(p.strip() for p in parts)
        # Skip heredoc bodies so their content is not parsed as instructions.
        for strip_tabs, _quote, delimiter in HEREDOC.findall(instruction):
            while i < len(lines):
                body = lines[i].lstrip('\t') if strip_tabs else lines[i]
                i += 1
                if body == delimiter:
                    break
            else:
                raise ValueError(f'line {start}: unterminated heredoc {delimiter!r}')
        yield start, instruction


def _flags(tokens):
    flags = []
    while tokens and tokens[0].startswith('--'):
        flags.append(tokens.pop(0))
    return flags


def analyse(text, approved_prefix):
    if not approved_prefix.endswith('/'):
        raise ValueError('approved prefix must end with "/"')
    pattern = re.compile(APPROVED_IMAGE.format(prefix=re.escape(approved_prefix)))
    stage_names = {}      # name -> stage index
    stage_roots = []      # stage index -> root approved ref
    refs = []
    for number, instruction in logical_instructions(text):
        tokens = instruction.split()
        keyword = tokens.pop(0).upper()
        if keyword == 'FROM':
            for flag in _flags(tokens):
                if not re.fullmatch(r'--platform=\S+', flag):
                    raise ValueError(f'line {number}: unsupported FROM flag {flag!r}')
            if len(tokens) == 3 and tokens[1].lower() == 'as':
                image, name = tokens[0], tokens[2].lower()
            elif len(tokens) == 1:
                image, name = tokens[0], None
            else:
                raise ValueError(f'line {number}: cannot parse FROM instruction')
            if '$' in image:
                raise ValueError(f'line {number}: build-arg substitution in FROM is not allowed')
            if image.lower() in stage_names:
                root = stage_roots[stage_names[image.lower()]]
            else:
                match = pattern.fullmatch(image)
                if not match:
                    raise ValueError(f'line {number}: {image!r} is not an approved image pinned by digest '
                                     f'(must start with {approved_prefix!r} and include @sha256:...)')
                root = f"{match['repo']}@{match['digest']}"
                if root not in refs:
                    refs.append(root)
            if name:
                stage_names[name] = len(stage_roots)
            stage_roots.append(root)
            continue
        if not stage_roots:
            if keyword == 'ARG':
                continue
            raise ValueError(f'line {number}: {keyword} before the first FROM')
        # Fail closed: ADD can fetch remote URLs and Git refs; variables, heredocs and
        # alternative Dockerfile frontends make a hand-written allowlist unsafe.
        # A vetted local COPY is supported, but never COPY --from=<external image>.
        if keyword == 'COPY':
            flags = _flags(tokens)
            for flag in flags:
                if flag.lower().startswith('--from='):
                    source = flag.split('=', 1)[1].lower()
                    known = source in stage_names or (source.isdigit() and int(source) < len(stage_roots))
                    if not known:
                        raise ValueError(f'line {number}: COPY --from={source} is not an earlier build stage')
                elif not (flag.lower() in ('--link', '--parents') or
                          any(flag.lower().startswith(prefix) and len(flag) > len(prefix)
                              for prefix in ('--chown=', '--chmod=', '--exclude='))):
                    raise ValueError(f'line {number}: unsupported COPY flag {flag!r}')
                if '$' in flag or '`' in flag:
                    raise ValueError(f'line {number}: dynamic COPY flag not permitted')
            # Dockerfile shell and JSON forms are both supported by Docker, but a
            # restrictive checker must reject anything it cannot unambiguously parse.
            # JSON-form COPY needs a real JSON decoder to distinguish literal sources.
            import json
            payload = instruction.split(None, 1)[1].strip()
            for flag in flags:
                if not payload.startswith(flag):
                    raise ValueError(f'line {number}: malformed COPY flags')
                payload = payload[len(flag):].lstrip()
            if payload.startswith('['):
                try:
                    items = json.loads(payload)
                except json.JSONDecodeError:
                    raise ValueError(f'line {number}: malformed JSON COPY') from None
                if not isinstance(items, list) or len(items) < 2 or not all(isinstance(v, str) for v in items):
                    raise ValueError(f'line {number}: invalid JSON COPY sources')
                sources = items[:-1]
            else:
                sources = tokens[:-1]
                if len(tokens) < 2:
                    raise ValueError(f'line {number}: invalid COPY source/destination')
                # Whitespace/quotes in shell-form paths have complex escaping semantics;
                # deny them instead of accidentally approving an unintended input.
                if any(c in payload for c in ('\\', '"', "'", '`')):
                    raise ValueError(f'line {number}: unsupported COPY escaping/quoting')
            if not sources or any('$' in source or '\x00' in source or
                                  re.match(r'^[a-z][a-z0-9+.-]*://', source, re.I) or
                                  source.startswith('git@') for source in sources):
                raise ValueError(f'line {number}: dynamic/external COPY source is not permitted')
        elif keyword in ('ADD', 'ONBUILD'):
            raise ValueError(f'line {number}: {keyword} is prohibited in approved application Dockerfiles')
        elif keyword == 'RUN':
            for flag in _flags(tokens):
                if flag.lower().startswith(('--mount', '--network', '--security')):
                    raise ValueError(f'line {number}: RUN {flag.split("=")[0]} requires a separately vetted build policy')
                raise ValueError(f'line {number}: unsupported RUN flag {flag!r}')
        elif keyword not in ALLOWED_INSTRUCTIONS:
            raise ValueError(f'line {number}: unapproved Dockerfile instruction {keyword!r}')
    if not refs:
        raise ValueError('no approved base image found')
    return {'bases': refs, 'final_base': stage_roots[-1]}


def base_images(text, approved_prefix):
    return analyse(text, approved_prefix)['bases']


def main():
    p = argparse.ArgumentParser()
    p.add_argument('dockerfile')
    p.add_argument('--approved-prefix', required=True, help='e.g. ghcr.io/example-org/approved/')
    p.add_argument('--final-base-output', help='write the final stage root base reference here')
    args = p.parse_args()
    try:
        result = analyse(pathlib.Path(args.dockerfile).read_text(), args.approved_prefix)
    except ValueError as e:
        raise SystemExit(f'ERROR: {e}')
    if args.final_base_output:
        pathlib.Path(args.final_base_output).write_text(result['final_base'] + '\n')
    print('\n'.join(result['bases']))


if __name__ == '__main__':
    main()
