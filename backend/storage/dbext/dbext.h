#include <sqlite3.h>
#include "./base58btc/base58btc.c"
#include "./carray/carray.c"
#include "./mycount/mycount.c"
#include "./roaring/roaring.c"
#include "./roaring/roaring_ext.c"
#include "./sha1/sha1.c"

static void load_extensions()
{
    sqlite3_auto_extension((void (*)(void))sqlite3_sha_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_mycount_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_carray_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_roaring_init);
    sqlite3_auto_extension((void (*)(void))sqlite3_base58btc_init);
}
