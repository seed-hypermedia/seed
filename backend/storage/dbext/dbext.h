#include <sqlite3.h>

int sqlite3_sha_init(sqlite3 *db, char **pzErrMsg, sqlite3_api_routines *pApi);
int sqlite3_mycount_init(sqlite3 *db, char **pzErrMsg, sqlite3_api_routines *pApi);
int sqlite3_carray_init(sqlite3 *db, char **pzErrMsg, sqlite3_api_routines *pApi);
int sqlite3_roaring_init(sqlite3 *db, char **pzErrMsg, sqlite3_api_routines *pApi);
int sqlite3_base58btc_init(sqlite3 *db, char **pzErrMsg, sqlite3_api_routines *pApi);

static void load_extensions()
{
    sqlite3_auto_extension((void (*)(void))sqlite3_sha_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_mycount_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_carray_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_roaring_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_base58btc_init);
}
