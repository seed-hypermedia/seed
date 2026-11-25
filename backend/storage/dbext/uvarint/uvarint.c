/* Encode the minimal unsigned varint used by multiformats, not SQLite's
 * internal varint format. Nonnegative SQLite integers cover the full uint63
 * range accepted by the CID reader. */
#include <sqlite3ext.h>
#include <stdint.h>
SQLITE_EXTENSION_INIT1

static void uvarintEncode(sqlite3_context *context, int argc, sqlite3_value **argv)
{
    (void)argc;
    if (sqlite3_value_type(argv[0]) != SQLITE_INTEGER || sqlite3_value_int64(argv[0]) < 0)
    {
        sqlite3_result_error(context, "uvarint_encode requires a nonnegative INTEGER", -1);
        return;
    }

    uint64_t value = (uint64_t)sqlite3_value_int64(argv[0]);
    unsigned char result[9];
    int size = 0;
    do
    {
        unsigned char byte = (unsigned char)(value & 0x7f);
        value >>= 7;
        result[size++] = byte | (value ? 0x80 : 0);
    } while (value);

    sqlite3_result_blob(context, result, size, SQLITE_TRANSIENT);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_uvarint_init(sqlite3 *db, char **pzErrMsg, const sqlite3_api_routines *pApi)
{
    (void)pzErrMsg;
    SQLITE_EXTENSION_INIT2(pApi);
    return sqlite3_create_function(db, "uvarint_encode", 1,
                                   SQLITE_UTF8 | SQLITE_INNOCUOUS | SQLITE_DETERMINISTIC,
                                   0, uvarintEncode, 0, 0);
}
