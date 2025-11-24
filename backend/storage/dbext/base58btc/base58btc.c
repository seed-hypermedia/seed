/*
 * sqlite3_base58btc.c
 *
 * SQLite extension providing:
 *   base58btc_encode(BLOB) -> TEXT  (Bitcoin base58 alphabet)
 *   base58btc_decode(TEXT) -> BLOB
 */

#include "sqlite3ext.h"
SQLITE_EXTENSION_INIT1

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* Bitcoin Base58 alphabet */
static const char BASE58_ALPHABET[] = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/* Decode table - filled at init time (-1 for invalid bytes). */
static int8_t BASE58_DECODE_TABLE[256];

/* Helper: initialize decode table (idempotent). */
static void init_decode_table(void){
    static int initialized = 0;
    if (initialized) return;
    initialized = 1;
    for (int i = 0; i < 256; ++i) BASE58_DECODE_TABLE[i] = -1;
    for (int i = 0; BASE58_ALPHABET[i] != '\0'; ++i) {
        unsigned char c = (unsigned char)BASE58_ALPHABET[i];
        BASE58_DECODE_TABLE[c] = (int8_t)i;
    }
}

/* base58btc_encode(blob) */
static void base58btc_encode_func(sqlite3_context *ctx, int argc, sqlite3_value **argv){
    (void)argc;
    if (sqlite3_value_type(argv[0]) == SQLITE_NULL) {
        sqlite3_result_null(ctx);
        return;
    }

    const unsigned char *in = sqlite3_value_blob(argv[0]);
    int in_len = sqlite3_value_bytes(argv[0]);

    if (in_len == 0) {
        /* empty input -> empty string */
        sqlite3_result_text(ctx, "", 0, SQLITE_STATIC);
        return;
    }

    /* count leading zeros */
    int zeros = 0;
    while (zeros < in_len && in[zeros] == 0) zeros++;

    /* allocate enough space for base58 digits:
       log(256)/log(58) ≈ 1.386 -> factor 138/100 is safe */
    int size = (int)((in_len - zeros) * 138 / 100) + 1;
    if (size <= 0) size = 1;

    unsigned char *b58 = (unsigned char *)sqlite3_malloc((size_t)size);
    if (!b58) {
        sqlite3_result_error_nomem(ctx);
        return;
    }
    memset(b58, 0, (size_t)size);

    /* convert bytes to base58 digits (big-integer division simulation) */
    int b58_len = 0; /* index of first non-zero in b58 (from left) */
    for (int i = zeros; i < in_len; ++i) {
        uint32_t carry = in[i];
        for (int j = size - 1; j >= 0; --j) {
            uint32_t val = (uint32_t)b58[j] * 256 + carry;
            b58[j] = (unsigned char)(val % 58);
            carry = val / 58;
        }
        /* if carry != 0 here, requested size was insufficient */
        if (carry != 0) {
            /* unexpected: allocation estimate insufficient */
            sqlite3_free(b58);
            sqlite3_result_error(ctx, "base58 encode overflow", -1);
            return;
        }
    }

    /* find first non-zero digit */
    int idx = 0;
    while (idx < size && b58[idx] == 0) idx++;

    /* result length = leading zeros as '1' + remaining digits */
    int result_len = zeros + (size - idx);
    if (result_len == 0) {
        /* only possible when input all zeros -> produce appropriate count of '1' */
        char *res = (char *)sqlite3_malloc((size_t)zeros + 1);
        if (!res) {
            sqlite3_free(b58);
            sqlite3_result_error_nomem(ctx);
            return;
        }
        for (int i = 0; i < zeros; ++i) res[i] = BASE58_ALPHABET[0];
        res[zeros] = '\0';
        sqlite3_result_text(ctx, res, zeros, sqlite3_free);
        sqlite3_free(b58);
        return;
    }

    /* allocate result string (not null-terminated required by sqlite, but nice) */
    char *out = (char *)sqlite3_malloc((size_t)result_len + 1);
    if (!out) {
        sqlite3_free(b58);
        sqlite3_result_error_nomem(ctx);
        return;
    }

    /* leading '1's for each input leading zero byte */
    int p = 0;
    for (int i = 0; i < zeros; ++i) out[p++] = BASE58_ALPHABET[0];

    /* convert base58 digits -> characters */
    for (int i = idx; i < size; ++i) {
        out[p++] = BASE58_ALPHABET[b58[i]];
    }

    out[p] = '\0';
    /* hand memory to sqlite; sqlite will call sqlite3_free when done */
    sqlite3_result_text(ctx, out, result_len, sqlite3_free);

    sqlite3_free(b58);
}

/* base58btc_decode(text) */
static void base58btc_decode_func(sqlite3_context *ctx, int argc, sqlite3_value **argv){
    (void)argc;
    init_decode_table();

    if (sqlite3_value_type(argv[0]) == SQLITE_NULL) {
        sqlite3_result_null(ctx);
        return;
    }

    const unsigned char *in = (const unsigned char *)sqlite3_value_text(argv[0]);
    int in_len = sqlite3_value_bytes(argv[0]);

    if (in_len == 0) {
        /* empty string -> empty blob */
        sqlite3_result_blob(ctx, "", 0, SQLITE_STATIC);
        return;
    }

    /* count leading '1' characters -> leading zero bytes */
    int zeros = 0;
    while (zeros < in_len && in[zeros] == (unsigned char)BASE58_ALPHABET[0]) zeros++;

    /* estimated decoded size: log(58)/log(256) ≈ 0.733 -> factor 733/1000 */
    int size = (int)((in_len - zeros) * 733 / 1000) + 1;
    if (size <= 0) size = 1;

    unsigned char *b256 = (unsigned char *)sqlite3_malloc((size_t)size);
    if (!b256) {
        sqlite3_result_error_nomem(ctx);
        return;
    }
    memset(b256, 0, (size_t)size);

    /* process characters */
    for (int i = zeros; i < in_len; ++i) {
        unsigned char ch = in[i];
        int8_t val = BASE58_DECODE_TABLE[ch];
        if (val == -1) {
            sqlite3_free(b256);
            sqlite3_result_error(ctx, "Invalid base58btc character", -1);
            return;
        }

        uint32_t carry = (uint32_t)val;
        for (int j = size - 1; j >= 0; --j) {
            uint32_t cur = (uint32_t)b256[j] * 58 + carry;
            b256[j] = (unsigned char)(cur & 0xFF);
            carry = cur >> 8;
        }

        if (carry != 0) {
            /* overflow: allocated buffer too small (should be rare with estimate) */
            sqlite3_free(b256);
            sqlite3_result_error(ctx, "base58btc decode overflow", -1);
            return;
        }
    }

    /* skip leading zero bytes in b256 */
    int idx = 0;
    while (idx < size && b256[idx] == 0) idx++;

    /* total length = leading zeros (from base58 '1') + bytes remaining */
    int out_len = zeros + (size - idx);

    /* allocate output buffer */
    unsigned char *out = (unsigned char *)sqlite3_malloc((size_t)out_len);
    if (!out) {
        sqlite3_free(b256);
        sqlite3_result_error_nomem(ctx);
        return;
    }

    /* leading zero bytes */
    int p = 0;
    for (int i = 0; i < zeros; ++i) out[p++] = 0x00;

    /* copy significant bytes */
    for (int i = idx; i < size; ++i) out[p++] = b256[i];

    /* deliver to sqlite and hand-off free() to sqlite */
    sqlite3_result_blob(ctx, out, out_len, sqlite3_free);

    sqlite3_free(b256);
}

/* Extension init */
#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_base58btc_init(sqlite3 *db, char **pzErrMsg, const sqlite3_api_routines *pApi){
    int rc;
    (void)pzErrMsg;
    SQLITE_EXTENSION_INIT2(pApi);

    /* prepare decode table */
    init_decode_table();

    rc = sqlite3_create_function(db, "base58btc_encode", 1,
                                 SQLITE_UTF8 | SQLITE_DETERMINISTIC,
                                 NULL, base58btc_encode_func, NULL, NULL);
    if (rc != SQLITE_OK) return rc;

    rc = sqlite3_create_function(db, "base58btc_decode", 1,
                                 SQLITE_UTF8 | SQLITE_DETERMINISTIC,
                                 NULL, base58btc_decode_func, NULL, NULL);
    return rc;
}
