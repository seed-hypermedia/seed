/* rbsr_sum accepts one 32-byte BLOB per row containing a precomputed
 * SHA-256 hash of an item.
 *
 * Inputs MUST be deduplicated by item identity before aggregation. This
 * function does not deduplicate or detect duplicates. Behavior is undefined
 * for non-deduplicated input; callers must not rely on any such result.
 *
 * The result is exactly 40 bytes: a 32-byte little-endian unsigned sum modulo
 * 2^256, followed by the item count as an 8-byte little-endian uint64.
 * Empty input returns 40 zero bytes. NULL, non-BLOB values, and lengths other
 * than 32 bytes are errors. This function performs no hashing; callers can
 * hash the result with SHA-256 and take its first 16 bytes for a fingerprint. */
#include <sqlite3ext.h>
#include <stdint.h>
#include <string.h>
SQLITE_EXTENSION_INIT1

typedef struct RbsrSumCtx
{
    unsigned char sum[32];
    uint64_t count;
} RbsrSumCtx;

static void rbsrSumStep(sqlite3_context *context, int argc, sqlite3_value **argv)
{
    (void)argc;
    if (sqlite3_value_type(argv[0]) != SQLITE_BLOB)
    {
        sqlite3_result_error(context, "rbsr_sum requires a 32-byte BLOB", -1);
        return;
    }

    const unsigned char *input = sqlite3_value_blob(argv[0]);
    int size = sqlite3_value_bytes(argv[0]);
    if (!input && size != 0)
    {
        sqlite3_result_error_nomem(context);
        return;
    }
    if (size != 32)
    {
        sqlite3_result_error(context, "rbsr_sum requires a 32-byte BLOB", -1);
        return;
    }

    /* SQLite zeroes new aggregate state and frees it after finalization. */
    RbsrSumCtx *state = sqlite3_aggregate_context(context, sizeof(*state));
    if (!state)
    {
        sqlite3_result_error_nomem(context);
        return;
    }

    unsigned int carry = 0;
    for (int i = 0; i < 32; ++i)
    {
        unsigned int value = state->sum[i] + input[i] + carry;
        state->sum[i] = (unsigned char)(value & 0xff);
        carry = value >> 8;
    }
    /* Discard the final carry for reduction modulo 2^256. */
    state->count++;
}

static void rbsrSumFinalize(sqlite3_context *context)
{
    unsigned char result[40] = {0};
    const RbsrSumCtx *state = sqlite3_aggregate_context(context, 0);
    if (state)
    {
        memcpy(result, state->sum, 32);
        /* Serialize explicitly so the count is independent of host byte order. */
        for (int i = 0; i < 8; ++i)
        {
            result[32 + i] = (unsigned char)(state->count >> (8 * i));
        }
    }
    /* Copy before SQLite releases the aggregate state. Empty sets return zero. */
    sqlite3_result_blob(context, result, sizeof(result), SQLITE_TRANSIENT);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_rbsr_init(sqlite3 *db, char **pzErrMsg, const sqlite3_api_routines *pApi)
{
    (void)pzErrMsg;
    SQLITE_EXTENSION_INIT2(pApi);
    return sqlite3_create_function(db, "rbsr_sum", 1,
                                   SQLITE_UTF8 | SQLITE_INNOCUOUS | SQLITE_DETERMINISTIC,
                                   0, 0, rbsrSumStep, rbsrSumFinalize);
}
