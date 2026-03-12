#!/bin/bash

# Advanced Media Controller — Translation Builder
# Compiles .po files to .mo binaries and manages the locale directory structure.
#
# Expected layout:
#   locale/<lang>/LC_MESSAGES/advanced-media-controller.po
#   locale/<lang>/LC_MESSAGES/advanced-media-controller.mo  ← produced by --compile

EXTENSION_NAME="advanced-media-controller"
LOCALE_DIR="locale"
POT_FILE="$LOCALE_DIR/$EXTENSION_NAME.pot"

# All shipped languages (en is the identity/fallback locale required by GJS)
SUPPORTED_LANGUAGES=("en" "de" "es" "fr" "ja" "zh_CN" "zh_TW")

# Spanish locale aliases — compiled from es and copied so GJS resolves
# es_ES, es@latin, and es_ES.UTF-8 without extra work in the extension.
ES_ALIASES=("es_ES" "es@latin")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── helpers ──────────────────────────────────────────────────────────────────

die() { echo -e "${RED}Error: $*${NC}" >&2; exit 1; }

require_msgfmt() {
    command -v msgfmt &>/dev/null && return
    echo -e "${RED}Error: msgfmt not found. Install gettext:${NC}"
    echo "  Debian/Ubuntu: sudo apt install gettext"
    echo "  Fedora:        sudo dnf install gettext"
    echo "  Arch:          sudo pacman -S gettext"
    echo "  macOS:         brew install gettext"
    exit 1
}

banner() {
    echo -e "${GREEN}Advanced Media Controller Translation Builder${NC}"
    echo "=============================================="
}

# ── extract ──────────────────────────────────────────────────────────────────

extract_strings() {
    echo -e "\n${YELLOW}Extracting translatable strings...${NC}"
    mkdir -p "$LOCALE_DIR"

    local sources=()
    while IFS= read -r -d '' f; do
        sources+=("$f")
    done < <(find . \
        -not -path "./$LOCALE_DIR/*" \
        -not -path "./node_modules/*" \
        -name "*.js" -print0 2>/dev/null)

    if [ ${#sources[@]} -eq 0 ]; then
        echo -e "${YELLOW}No .js source files found — skipping extraction${NC}"
        return 0
    fi

    xgettext --from-code=UTF-8 \
             --keyword=_ \
             --keyword=_n:1,2 \
             --package-name="$EXTENSION_NAME" \
             --package-version="5.2" \
             --msgid-bugs-address="https://github.com/Sanjai-Shaarugesh/Advance-media-controller/issues" \
             --output="$POT_FILE" \
             "${sources[@]}" 2>/dev/null || true

    if [ -f "$POT_FILE" ]; then
        local count
        count=$(grep -c '^msgid ' "$POT_FILE" 2>/dev/null || echo 0)
        echo -e "${GREEN}✓${NC} Template created: $POT_FILE ($count strings)"
    else
        echo -e "${YELLOW}No template created (no translatable strings found)${NC}"
    fi
}

# ── compile one language ─────────────────────────────────────────────────────

compile_translation() {
    local lang=$1
    local po_file="$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.po"
    local mo_file="$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.mo"

    if [ ! -f "$po_file" ]; then
        echo -e "${RED}✗${NC} $lang: .po file not found at $po_file"
        return 1
    fi

    # Validate without aborting the script
    local errors
    errors=$(msgfmt -c "$po_file" -o /dev/null 2>&1)
    if [ $? -ne 0 ]; then
        echo -e "${RED}✗${NC} $lang: Validation failed"
        echo "$errors" | sed 's/^/    /'
        return 1
    fi

    msgfmt "$po_file" -o "$mo_file"
    local stats
    stats=$(msgfmt --statistics "$po_file" -o /dev/null 2>&1)
    echo -e "${GREEN}✓${NC} $lang: Compiled successfully"
    echo "  └─ $stats"

    # Spanish aliases: copy compiled .mo (and .po) into es_ES / es@latin dirs
    # so GJS can resolve all common Spanish locale identifiers out of the box.
    if [ "$lang" = "es" ]; then
        for alias in "${ES_ALIASES[@]}"; do
            local alias_dir="$LOCALE_DIR/$alias/LC_MESSAGES"
            mkdir -p "$alias_dir"
            cp "$mo_file" "$alias_dir/$EXTENSION_NAME.mo"
            cp "$po_file" "$alias_dir/$EXTENSION_NAME.po"
            echo -e "  ${BLUE}↳${NC} alias $alias created"
        done
    fi

    return 0
}

# ── compile all ──────────────────────────────────────────────────────────────

compile_all() {
    echo -e "\n${YELLOW}Compiling all translations...${NC}"

    local success=0 failed=0 skipped=0

    # Compile the officially supported set first
    for lang in "${SUPPORTED_LANGUAGES[@]}"; do
        if [ -f "$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.po" ]; then
            if compile_translation "$lang"; then
                ((success++))
            else
                ((failed++))
            fi
        else
            echo -e "${YELLOW}⊘${NC} $lang: not found, skipping"
            ((skipped++))
        fi
    done

    # Then pick up any extra languages present in the locale tree
    while IFS= read -r -d '' po_file; do
        local lang
        lang=$(basename "$(dirname "$(dirname "$po_file")")")

        # Skip already-processed supported languages
        local already=false
        for sl in "${SUPPORTED_LANGUAGES[@]}"; do
            [ "$lang" = "$sl" ] && already=true && break
        done
        # Skip alias directories (es_ES, es@latin) — they are outputs, not inputs
        for alias in "${ES_ALIASES[@]}"; do
            [ "$lang" = "$alias" ] && already=true && break
        done

        if [ "$already" = false ]; then
            if compile_translation "$lang"; then
                ((success++))
            else
                ((failed++))
            fi
        fi
    done < <(find "$LOCALE_DIR" -name "$EXTENSION_NAME.po" -print0 2>/dev/null)

    echo ""
    echo -e "${GREEN}Summary:${NC}"
    echo "  Compiled:  $success"
    [ "$skipped" -gt 0 ] && echo "  Skipped:   $skipped"
    if [ "$failed" -gt 0 ]; then
        echo -e "  ${RED}Failed:    $failed${NC}"
        return 1
    fi
    return 0
}

# ── update from template ──────────────────────────────────────────────────────

update_translation() {
    local lang=$1
    local po_file="$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.po"

    [ -f "$POT_FILE" ] || die "Template not found. Run --extract first."

    if [ ! -f "$po_file" ]; then
        echo -e "${YELLOW}Creating new translation file for $lang${NC}"
        mkdir -p "$LOCALE_DIR/$lang/LC_MESSAGES"
        msginit --input="$POT_FILE" \
                --output-file="$po_file" \
                --locale="$lang" \
                --no-translator
    else
        echo -e "${YELLOW}Updating $lang from template...${NC}"
        msgmerge --update --quiet "$po_file" "$POT_FILE"
    fi
    echo -e "${GREEN}✓${NC} $lang: Updated"
}

# ── create new locale ─────────────────────────────────────────────────────────

create_translation() {
    local lang=$1
    [ -n "$lang" ] || die "Language code required.\nUsage: $0 --create LANG_CODE"

    local po_file="$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.po"
    [ ! -f "$po_file" ] || die "Translation for $lang already exists at $po_file"

    if [ ! -f "$POT_FILE" ]; then
        echo -e "${YELLOW}Template not found — extracting strings first...${NC}"
        extract_strings
    fi

    echo -e "${YELLOW}Creating new translation for $lang...${NC}"
    mkdir -p "$LOCALE_DIR/$lang/LC_MESSAGES"
    msginit --input="$POT_FILE" \
            --output-file="$po_file" \
            --locale="$lang" \
            --no-translator

    echo -e "${GREEN}✓${NC} Created: $po_file"
    echo ""
    echo "Next steps:"
    echo "  1. Edit $po_file and fill in the msgstr values"
    echo "  2. Run: $0 --compile $lang"
    echo "  3. Restart GNOME Shell to test"
}

# ── list ──────────────────────────────────────────────────────────────────────

list_translations() {
    echo -e "\n${YELLOW}Available translations:${NC}"

    local found=0
    while IFS= read -r -d '' po_file; do
        local lang mo_file compiled stats
        lang=$(basename "$(dirname "$(dirname "$po_file")")")
        mo_file="${po_file%.po}.mo"
        found=1

        if [ -f "$mo_file" ]; then
            if [ "$mo_file" -nt "$po_file" ]; then
                compiled="${GREEN}[compiled]${NC}"
            else
                compiled="${YELLOW}[needs recompile]${NC}"
            fi
        else
            compiled="${RED}[not compiled]${NC}"
        fi

        stats=$(msgfmt --statistics "$po_file" -o /dev/null 2>&1)
        echo -e "  ${BLUE}$lang${NC} $compiled"
        echo "    └─ $stats"
    done < <(find "$LOCALE_DIR" -name "$EXTENSION_NAME.po" -print0 2>/dev/null | sort -z)

    [ "$found" -eq 0 ] && echo "  (none found under $LOCALE_DIR/)"
}

# ── clean ─────────────────────────────────────────────────────────────────────

clean_backups() {
    echo -e "\n${YELLOW}Cleaning backup files...${NC}"
    local count
    count=$(find "$LOCALE_DIR" -name "*.po~" 2>/dev/null | wc -l)
    if [ "$count" -gt 0 ]; then
        find "$LOCALE_DIR" -name "*.po~" -delete
        echo -e "${GREEN}✓${NC} Removed $count backup file(s)"
    else
        echo -e "${GREEN}✓${NC} No backup files found"
    fi
}

# ── help ──────────────────────────────────────────────────────────────────────

show_help() {
    cat << EOF
Advanced Media Controller Translation Builder

Usage: $0 [OPTION] [LANG]

Options:
  --extract              Extract translatable strings from *.js → template POT
  --compile [LANG]       Compile .po → .mo  (all languages if LANG omitted)
  --update LANG          Merge new strings from template into an existing .po
  --create LANG          Scaffold a new .po file from the template
  --list                 Show all translations and their compile status
  --clean                Remove msgmerge backup files (*.po~)
  --all                  extract → update all → compile all → clean
  --help                 Show this message

Supported languages (shipped):
  en        English  (identity / fallback locale — required by GJS)
  de        German
  es        Spanish  (aliases es_ES and es@latin are auto-created on compile)
  fr        French
  ja        Japanese
  zh_CN     Chinese Simplified
  zh_TW     Chinese Traditional

Examples:
  $0 --compile              # Compile every language
  $0 --compile de           # Compile only German
  $0 --update fr            # Pull new strings into French .po
  $0 --create pt_BR         # Scaffold Brazilian Portuguese
  $0 --list                 # Show status of all translations
  $0 --all                  # Full rebuild cycle

Additional language codes you can scaffold with --create:
  pt, pt_BR, it, ko, ru, ar, hi, nl, pl, tr, sv, nb, fi, cs, hu

EOF
}

# ── dispatch ──────────────────────────────────────────────────────────────────

banner
require_msgfmt

case "${1:-}" in
    --extract)
        extract_strings
        ;;
    --compile)
        if [ -n "$2" ]; then
            compile_translation "$2"
        else
            compile_all
        fi
        ;;
    --update)
        [ -n "$2" ] || die "Language code required.\nUsage: $0 --update LANG"
        update_translation "$2"
        ;;
    --create)
        create_translation "$2"
        ;;
    --list)
        list_translations
        ;;
    --clean)
        clean_backups
        ;;
    --all)
        extract_strings
        echo -e "\n${YELLOW}Updating all translations from template...${NC}"
        for lang in "${SUPPORTED_LANGUAGES[@]}"; do
            po="$LOCALE_DIR/$lang/LC_MESSAGES/$EXTENSION_NAME.po"
            [ -f "$po" ] && update_translation "$lang"
        done
        compile_all
        clean_backups
        ;;
    --help|"")
        show_help
        ;;
    *)
        echo -e "${RED}Unknown option: $1${NC}"
        show_help
        exit 1
        ;;
esac

exit 0
