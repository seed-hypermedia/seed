// This file was copied and adapted from https://github.com/oldmoe/roaringlite/blob/main/src/libsqlite3roaring.c.

#include <stddef.h>
#include <sqlite3ext.h>
#include "roaring.h"
SQLITE_EXTENSION_INIT1

/* Insert your extension code here */

static void roaringFreeFunc(roaring_bitmap_t *p){
  roaring_bitmap_free(p);
}

static void roaring64FreeFunc(roaring64_bitmap_t *p){
  roaring64_bitmap_free(p);
}


/*********************************************
  rb_create(e1, e2, e3, .. , en)
  --------------------------------------------
  creates a new bitmap comprised of all the supplied integers
*********************************************/
static void roaringCreateFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  roaring_bitmap_t *r = roaring_bitmap_create();
  for(int i=0; i < argc; i++){
    if( sqlite3_value_type(argv[i])!=SQLITE_INTEGER ){
      sqlite3_result_error(context, "invalid argument", -1);
      return;
    }
    roaring_bitmap_add(r, sqlite3_value_int(argv[i]));
  }
  int nSize = (int )roaring_bitmap_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring_bitmap_serialize(r, pOut);
  roaring_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64CreateFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  roaring64_bitmap_t *r = roaring64_bitmap_create();
  for(int i=0; i < argc; i++){
    if( sqlite3_value_type(argv[i])!=SQLITE_INTEGER ){
      sqlite3_result_error(context, "invalid argument", -1);
      return;
    }
    roaring64_bitmap_add(r, sqlite3_value_int64(argv[i]));
  }
  int nSize = (int )roaring64_bitmap_portable_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring64_bitmap_portable_serialize(r, pOut);
  roaring64_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*
  struct to hold a roaring bitmap
*/
typedef struct RoaringContext RoaringContext;
struct RoaringContext {
  unsigned init;
  roaring_bitmap_t *rb;
};

typedef struct Roaring64Context Roaring64Context;
struct Roaring64Context {
  unsigned init;
  roaring64_bitmap_t *rb;
};


/*********************************************
  rb_group_create(col)
  --------------------------------------------
  creates a bitmap from a SQL aggregation

  example: SELECT rb_group_create(col) FROM table;
*********************************************/
static void roaringCreateStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  RoaringContext *rc;

  // bail out if the value supplied is not an integer
  if( sqlite3_value_type(argv[0])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }

  // check if the context already has the roaring bitmap
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->init == 0){
    // create a roaring bitmap
    rc->rb = roaring_bitmap_create();
    if(rc->rb == NULL){
      memset(rc, 0, sizeof(*rc));
      sqlite3_result_error(context, "failed to create bitmap in step", -1);
      return;
    }
    rc->init = 1;
  }
  roaring_bitmap_add(rc->rb, sqlite3_value_int(argv[0]));
}

static void roaringCreateFinal(sqlite3_context *context){
  RoaringContext *rc;
  int nOut, nSize;

  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring_bitmap_create();
  }
  nSize = (int )roaring_bitmap_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(rc->rb, pOut);
  roaring_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64CreateStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  Roaring64Context *rc;

  // bail out if the value supplied is not an integer
  if( sqlite3_value_type(argv[0])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }

  // check if the context already has the roaring bitmap
  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->init == 0){
    // create a roaring bitmap
    rc->rb = roaring64_bitmap_create();
    if(rc->rb == NULL){
      memset(rc, 0, sizeof(*rc));
      sqlite3_result_error(context, "failed to create bitmap in step", -1);
      return;
    }
    rc->init = 1;
  }
  roaring64_bitmap_add(rc->rb, sqlite3_value_int64(argv[0]));
}

static void roaring64CreateFinal(sqlite3_context *context){
  Roaring64Context *rc;
  int nOut, nSize;

  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring64_bitmap_create();
  }
  nSize = (int )roaring64_bitmap_portable_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring64_bitmap_portable_serialize(rc->rb, pOut);
  roaring64_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}


/*
static void roaringCreatePFinal(sqlite3_context *context){
  RoaringContext *rc;
  int nOut, nSize;
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  nSize = (int )roaring_bitmap_size_in_bytes(rc->rb);
  sqlite3_result_pointer(context, rc->rb, "rbitmap", roaringFreeFunc);
}
*/
/*********************************************
  rb_add(bitmap, element)
  --------------------------------------------
  adds an element to the bitmap and returns the new bitmap
*********************************************/
static void roaringAddFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring_bitmap_t *r = roaring_bitmap_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  if( sqlite3_value_type(argv[1])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }
  roaring_bitmap_add(r, sqlite3_value_int(argv[1]));
  int nSize = (int) roaring_bitmap_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring_bitmap_serialize(r, pOut);
  roaring_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64AddFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring64_bitmap_t *r = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  if( sqlite3_value_type(argv[1])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }
  roaring64_bitmap_add(r, sqlite3_value_int64(argv[1]));
  int nSize = (int) roaring64_bitmap_portable_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring64_bitmap_portable_serialize(r, pOut);
  roaring64_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}


/*********************************************
  rb_remove(bitmap, element)
  --------------------------------------------
  removes an element from a bitmap and returns the new bitmap
*********************************************/
static void roaringRemoveFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring_bitmap_t *r = roaring_bitmap_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  if( sqlite3_value_type(argv[1])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }
  roaring_bitmap_remove(r, sqlite3_value_int(argv[1]));
  int nSize = (int) roaring_bitmap_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring_bitmap_serialize(r, pOut);
  roaring_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64RemoveFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring64_bitmap_t *r = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  if( sqlite3_value_type(argv[1])!=SQLITE_INTEGER ){
    sqlite3_result_error(context, "invalid argument", -1);
    return;
  }
  roaring64_bitmap_remove(r, sqlite3_value_int64(argv[1]));
  int nSize = (int) roaring64_bitmap_portable_size_in_bytes(r);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring64_bitmap_portable_serialize(r, pOut);
  roaring64_bitmap_free(r);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*********************************************
  rb_and_length(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the length of the result
*********************************************/
static void roaringAndLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring_bitmap_and_cardinality(r1, r2);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_int(context, nOut);
}

static void roaring64AndLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring64_bitmap_and_cardinality(r1, r2);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_int64(context, nOut);
}


/*********************************************
  rb_and_many(bitmap1, bitmap2, bitmap3, ...)
  --------------------------------------------
  Bitwise AND all bitmaps and return the result
*********************************************/

static void roaringAndManyFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  roaring_bitmap_t *rfinal;
  roaring_bitmap_t *r;
  for(int i=0; i < argc; i++){
    if(sqlite3_value_type(argv[i])!=SQLITE_BLOB){
      continue;
    }
    r = roaring_bitmap_deserialize_safe(sqlite3_value_blob(argv[i]), sqlite3_value_bytes(argv[i]));
    if( r == NULL){
      sqlite3_result_error(context, "invalid bitmap(s)", -1);
      return;
    }
    if(rfinal == NULL){
      rfinal = roaring_bitmap_copy(r);
    } else {
      roaring_bitmap_and_inplace(rfinal, r);
      roaring_bitmap_free(r);
    }
  }
  if(rfinal == NULL){
    rfinal = roaring_bitmap_create();
  }
  int nSize = (int )roaring_bitmap_size_in_bytes(rfinal);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring_bitmap_serialize(rfinal, pOut);
  roaring_bitmap_free(rfinal);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64AndManyFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  roaring64_bitmap_t *rfinal;
  roaring64_bitmap_t *r;
  for(int i=0; i < argc; i++){
    if(sqlite3_value_type(argv[i])!=SQLITE_BLOB){
      continue;
    }
    r = roaring64_bitmap_portable_deserialize_safe(sqlite3_value_blob(argv[i]), sqlite3_value_bytes(argv[i]));
    if( r == NULL){
      sqlite3_result_error(context, "invalid bitmap(s)", -1);
      return;
    }
    if(rfinal == NULL){
      rfinal = roaring64_bitmap_copy(r);
    } else {
      roaring64_bitmap_and_inplace(rfinal, r);
      roaring64_bitmap_free(r);
    }
  }
  if(rfinal == NULL){
    rfinal = roaring64_bitmap_create();
  }
  int nSize = (int) roaring64_bitmap_portable_size_in_bytes(rfinal);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring64_bitmap_portable_serialize(rfinal, pOut);
  roaring64_bitmap_free(rfinal);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}


/*********************************************
  rb_or_many(bitmap1, bitmap2, bitmap3, ...)
  --------------------------------------------
  Bitwise OR all bitmaps and return the result
*********************************************/

static void roaringOrManyFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  roaring_bitmap_t *rfinal;
  roaring_bitmap_t *r;
  rfinal = roaring_bitmap_create();
  for(int i=0; i < argc; i++){
    if(sqlite3_value_type(argv[i])!=SQLITE_BLOB){
      continue;
    }
    r = roaring_bitmap_deserialize_safe(sqlite3_value_blob(argv[i]), sqlite3_value_bytes(argv[i]));
    if( r == NULL){
      sqlite3_result_error(context, "invalid bitmap(s)", -1);
      return;
    }
    roaring_bitmap_or_inplace(rfinal, r);
    roaring_bitmap_free(r);
  }
  int nSize = (int )roaring_bitmap_size_in_bytes(rfinal);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring_bitmap_serialize(rfinal, pOut);
  roaring_bitmap_free(rfinal);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64OrManyFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  roaring64_bitmap_t *rfinal;
  roaring64_bitmap_t *r;
  rfinal = roaring64_bitmap_create();
  for(int i=0; i < argc; i++){
    if(sqlite3_value_type(argv[i])!=SQLITE_BLOB){
      continue;
    }
    r = roaring64_bitmap_portable_deserialize_safe(sqlite3_value_blob(argv[i]), sqlite3_value_bytes(argv[i]));
    if( r == NULL){
      sqlite3_result_error(context, "invalid bitmap(s)", -1);
      return;
    }
    roaring64_bitmap_or_inplace(rfinal, r);
    roaring64_bitmap_free(r);
  }
  int nSize = (int )roaring64_bitmap_portable_size_in_bytes(rfinal);
  char *pOut = sqlite3_malloc(nSize);
  int nOut = (int) roaring64_bitmap_portable_serialize(rfinal, pOut);
  roaring64_bitmap_free(rfinal);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}


/*********************************************
  rb_and(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringAndFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring_bitmap_and_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring_bitmap_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(r1, pOut);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64AndFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring64_bitmap_and_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring64_bitmap_portable_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring64_bitmap_portable_serialize(r1, pOut);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*********************************************
  rb_not(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringNotFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring_bitmap_andnot_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring_bitmap_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(r1, pOut);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64NotFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring64_bitmap_andnot_inplace(r1, r2);
  int64_t nOut, nSize;
  nSize = (int64_t) roaring64_bitmap_portable_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int64_t) roaring64_bitmap_portable_serialize(r1, pOut);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*********************************************
  rb_not_length(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringNotLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring_bitmap_andnot_cardinality(r1, r2);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_int(context, nOut);
  //roaring_bitmap_and_inplace(r1, r2);
}

static void roaring64NotLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int64_t nOut = (int64_t) roaring64_bitmap_andnot_cardinality(r1, r2);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_int64(context, nOut);
  //roaring_bitmap_and_inplace(r1, r2);
}

/*********************************************
  rb_xor(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringXorFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring_bitmap_xor_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring_bitmap_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(r1, pOut);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64XorFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring64_bitmap_xor_inplace(r1, r2);
  int64_t nOut, nSize;
  nSize = (int64_t) roaring64_bitmap_portable_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int64_t) roaring64_bitmap_portable_serialize(r1, pOut);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*********************************************
  rb_xor_length(bitmap1, bitmap2)
  --------------------------------------------
  and the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringXorLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring_bitmap_xor_cardinality(r1, r2);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_int(context, nOut);
}

static void roaring64XorLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring64_bitmap_xor_cardinality(r1, r2);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_int64(context, nOut);
}

/*********************************************
  rb_or_length(bitmap1, bitmap2)
  --------------------------------------------
  or the second bitmap with the first one (first one is modified) and returns the length of the result
*********************************************/
static void roaringOrLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring_bitmap_or_cardinality(r1, r2);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_int(context, nOut);
}

static void roaring64OrLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  int nOut = (int) roaring64_bitmap_or_cardinality(r1, r2);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_int(context, nOut);
}


/*********************************************
  rb_or(bitmap1, bitmap2)
  --------------------------------------------
  or the second bitmap with the first one (first one is modified) and returns the first bitmap
*********************************************/
static void roaringOrFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring_bitmap_t *r1 = roaring_bitmap_deserialize_safe(pIn1, nIn1);
  roaring_bitmap_t *r2 = roaring_bitmap_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring_bitmap_or_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring_bitmap_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(r1, pOut);
  roaring_bitmap_free(r1);
  roaring_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64OrFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn1;
  unsigned int nIn1;
  const char *pIn2;
  unsigned int nIn2;
  pIn1 = sqlite3_value_blob(argv[0]);
  nIn1 = sqlite3_value_bytes(argv[0]);
  pIn2 = sqlite3_value_blob(argv[1]);
  nIn2 = sqlite3_value_bytes(argv[1]);
  roaring64_bitmap_t *r1 = roaring64_bitmap_portable_deserialize_safe(pIn1, nIn1);
  roaring64_bitmap_t *r2 = roaring64_bitmap_portable_deserialize_safe(pIn2, nIn2);
  if( r1 == NULL || r2 == NULL){
    sqlite3_result_error(context, "invalid bitmap(s)", -1);
    return;
  }
  roaring64_bitmap_or_inplace(r1, r2);
  int nOut, nSize;
  nSize = (int) roaring64_bitmap_portable_size_in_bytes(r1);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring64_bitmap_portable_serialize(r1, pOut);
  roaring64_bitmap_free(r1);
  roaring64_bitmap_free(r2);
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

/*********************************************
  rb_group_and(col)
  --------------------------------------------
  and all the values in col

  example: SELECT rb_group_and(col) FROM table
*********************************************/

static void roaringAndAllStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  const char *pIn;
  unsigned int nIn;
  //const char *pInAnd;
  //unsigned int nInAnd;
  RoaringContext *rc;
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);

  if(rc->init == 0){
    rc->init = 1;
    rc->rb = roaring_bitmap_deserialize_safe(pIn, nIn);
    if( rc->rb == NULL ){
      sqlite3_result_error(context, "invalid bitmap", -1);
      return;
    }
  }else{
    roaring_bitmap_t *r = roaring_bitmap_deserialize_safe(pIn, nIn);
    if( r == NULL ){
      sqlite3_result_error(context, "invalid bitmap", -1);
      return;
    }
    roaring_bitmap_and_inplace(rc->rb, r);
    roaring_bitmap_free(r);
  }

}


static void roaringAndAllFinal(sqlite3_context *context){
  RoaringContext *rc;
  int nOut, nSize;
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring_bitmap_create();
  }
  nSize = (int) roaring_bitmap_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(rc->rb, pOut);
  roaring_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64AndAllStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  const char *pIn;
  unsigned int nIn;
  //const char *pInAnd;
  //unsigned int nInAnd;
  Roaring64Context *rc;
  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);

  if(rc->init == 0){
    rc->init = 1;
    rc->rb = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
    if( rc->rb == NULL ){
      sqlite3_result_error(context, "invalid bitmap", -1);
      return;
    }
  }else{
    roaring64_bitmap_t *r = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
    if( r == NULL ){
      sqlite3_result_error(context, "invalid bitmap", -1);
      return;
    }
    roaring64_bitmap_and_inplace(rc->rb, r);
    roaring64_bitmap_free(r);
  }

}

static void roaring64AndAllFinal(sqlite3_context *context){
  Roaring64Context *rc;
  int64_t nOut, nSize;
  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring64_bitmap_create();
  }
  nSize = (int64_t) roaring64_bitmap_portable_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int64_t) roaring64_bitmap_portable_serialize(rc->rb, pOut);
  roaring64_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}


/*********************************************
  rb_group_or(col)
  --------------------------------------------
  or all the values in col

  example: SELECT rb_group_or(col) FROM table
*********************************************/
static void roaringOrAllStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  const char *pIn;
  unsigned int nIn;
  //const char *pInAnd;
  //unsigned int nInAnd;
  RoaringContext *rc;
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->init == 0){
    rc->init = 1;
    rc->rb = roaring_bitmap_create();
  }
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring_bitmap_t *r = roaring_bitmap_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  roaring_bitmap_or_inplace(rc->rb, r);
  roaring_bitmap_free(r);
}

static void roaringOrAllFinal(sqlite3_context *context){
  RoaringContext *rc;
  int nOut, nSize;
  rc = (RoaringContext*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring_bitmap_create();
  }
  nSize = (int) roaring_bitmap_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int) roaring_bitmap_serialize(rc->rb, pOut);
  roaring_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}

static void roaring64OrAllStep(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){

  const char *pIn;
  unsigned int nIn;
  //const char *pInAnd;
  //unsigned int nInAnd;
  Roaring64Context *rc;
  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->init == 0){
    rc->init = 1;
    rc->rb = roaring64_bitmap_create();
  }
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring64_bitmap_t *r = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  roaring64_bitmap_or_inplace(rc->rb, r);
  roaring64_bitmap_free(r);
}

static void roaring64OrAllFinal(sqlite3_context *context){
  Roaring64Context *rc;
  int64_t nOut, nSize;
  rc = (Roaring64Context*)sqlite3_aggregate_context(context, sizeof(*rc));
  if(rc->rb == NULL){
    // no rb was created, must be an empty result set
    rc->rb = roaring64_bitmap_create();
  }
  nSize = (int64_t) roaring64_bitmap_portable_size_in_bytes(rc->rb);
  char *pOut = sqlite3_malloc(nSize);
  nOut = (int64_t) roaring64_bitmap_portable_serialize(rc->rb, pOut);
  roaring64_bitmap_free(rc->rb);
  memset(rc, 0, sizeof(*rc));
  sqlite3_result_blob(context, pOut, nOut, sqlite3_free);
}




#ifndef SQLITE_OMIT_VIRTUALTABLE
/*
** rb_each virtual table implementation
*/

typedef struct rb_vtab rb_vtab;
struct rb_vtab {
  sqlite3_vtab base;
};

typedef struct rb_cursor rb_cursor;
struct rb_cursor {
  sqlite3_vtab_cursor base;
  roaring_bitmap_t *pBitmap;
  roaring_uint32_iterator_t *pIter;
  sqlite3_int64 iRowid;
  int bEof;
  uint32_t currentValue;
};

static int rbConnect(
  sqlite3 *db,
  void *pAux,
  int argc, const char *const*argv,
  sqlite3_vtab **ppVtab,
  char **pzErr
){
  rb_vtab *pNew;
  int rc;
  rc = sqlite3_declare_vtab(db, "CREATE TABLE x(value, data hidden)");
  if( rc==SQLITE_OK ){
    pNew = sqlite3_malloc( sizeof(*pNew) );
    *ppVtab = (sqlite3_vtab*)pNew;
    if( pNew==0 ) return SQLITE_NOMEM;
    memset(pNew, 0, sizeof(*pNew));
  } else {
    if( pzErr ) *pzErr = sqlite3_mprintf("rbConnect failed: %d", rc);
  }
  return rc;
}

static int rbDisconnect(sqlite3_vtab *pVtab){
  sqlite3_free(pVtab);
  return SQLITE_OK;
}

static int rbOpen(sqlite3_vtab *p, sqlite3_vtab_cursor **ppCursor){
  rb_cursor *pCur;
  pCur = sqlite3_malloc( sizeof(*pCur) );
  if( pCur==0 ) return SQLITE_NOMEM;
  memset(pCur, 0, sizeof(*pCur));
  *ppCursor = &pCur->base;
  return SQLITE_OK;
}

static int rbClose(sqlite3_vtab_cursor *cur){
  rb_cursor *pCur = (rb_cursor*)cur;
  if( pCur->pIter ) roaring_uint32_iterator_free(pCur->pIter);
  if( pCur->pBitmap ) roaring_bitmap_free(pCur->pBitmap);
  sqlite3_free(pCur);
  return SQLITE_OK;
}

static int rbNext(sqlite3_vtab_cursor *cur){
  rb_cursor *pCur = (rb_cursor*)cur;
  if( !pCur->pIter ) return SQLITE_OK;

  roaring_uint32_iterator_advance(pCur->pIter);
  if( pCur->pIter->has_value ){
    pCur->currentValue = pCur->pIter->current_value;
    pCur->bEof = 0;
    pCur->iRowid++;
  } else {
    pCur->bEof = 1;
  }
  return SQLITE_OK;
}

static int rbColumn(
  sqlite3_vtab_cursor *cur,
  sqlite3_context *ctx,
  int i
){
  rb_cursor *pCur = (rb_cursor*)cur;
  if( i==0 && !pCur->bEof ){
    sqlite3_result_int64(ctx, pCur->currentValue);
  }
  return SQLITE_OK;
}

static int rbRowid(sqlite3_vtab_cursor *cur, sqlite_int64 *pRowid){
  rb_cursor *pCur = (rb_cursor*)cur;
  *pRowid = pCur->iRowid;
  return SQLITE_OK;
}

static int rbEof(sqlite3_vtab_cursor *cur){
  rb_cursor *pCur = (rb_cursor*)cur;
  return pCur->bEof;
}

static int rbFilter(
  sqlite3_vtab_cursor *pVtabCursor,
  int idxNum, const char *idxStr,
  int argc, sqlite3_value **argv
){
  rb_cursor *pCur = (rb_cursor *)pVtabCursor;

  // Cleanup previous run
  if( pCur->pIter ){
    roaring_uint32_iterator_free(pCur->pIter);
    pCur->pIter = NULL;
  }
  if( pCur->pBitmap ){
    roaring_bitmap_free(pCur->pBitmap);
    pCur->pBitmap = NULL;
  }

  pCur->iRowid = 0;
  pCur->bEof = 1; // Default to empty

  if( argc > 0 ){
    const char *pIn = sqlite3_value_blob(argv[0]);
    unsigned int nIn = sqlite3_value_bytes(argv[0]);
    if( pIn && nIn > 0 ){
        pCur->pBitmap = roaring_bitmap_deserialize_safe(pIn, nIn);
        if( pCur->pBitmap ){
            pCur->pIter = roaring_iterator_create(pCur->pBitmap);
            if( pCur->pIter && pCur->pIter->has_value ){
                pCur->currentValue = pCur->pIter->current_value;
                pCur->bEof = 0;
            }
        }
    }
  }
  return SQLITE_OK;
}

static int rbBestIndex(
  sqlite3_vtab *tab,
  sqlite3_index_info *pIdxInfo
){
  int i;
  int idxArg = -1;

  for(i=0; i<pIdxInfo->nConstraint; i++){
    if( pIdxInfo->aConstraint[i].iColumn == 1 && pIdxInfo->aConstraint[i].op == SQLITE_INDEX_CONSTRAINT_EQ ){
       if( pIdxInfo->aConstraint[i].usable ){
           idxArg = i;
           break;
       }
    }
  }

  if( idxArg >= 0 ){
    pIdxInfo->aConstraintUsage[idxArg].argvIndex = 1;
    pIdxInfo->aConstraintUsage[idxArg].omit = 1;
    pIdxInfo->estimatedCost = 1.0;
    pIdxInfo->estimatedRows = 100;
  } else {
    pIdxInfo->estimatedCost = 1000000.0;
    pIdxInfo->estimatedRows = 1000000;
  }

  return SQLITE_OK;
}

static sqlite3_module rbModule = {
  0,                         /* iVersion */
  0,                         /* xCreate */
  rbConnect,                 /* xConnect */
  rbBestIndex,               /* xBestIndex */
  rbDisconnect,              /* xDisconnect */
  0,                         /* xDestroy */
  rbOpen,                    /* xOpen - open a cursor */
  rbClose,                   /* xClose - close a cursor */
  rbFilter,                  /* xFilter - configure scan constraints */
  rbNext,                    /* xNext - advance a cursor */
  rbEof,                     /* xEof - check for end of scan */
  rbColumn,                  /* xColumn - read data */
  rbRowid,                   /* xRowid - read data */
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};

/*
** rb64_each virtual table implementation
*/

typedef struct rb64_cursor rb64_cursor;
struct rb64_cursor {
  sqlite3_vtab_cursor base;
  roaring64_bitmap_t *pBitmap;
  roaring64_iterator_t *pIter;
  sqlite3_int64 iRowid;
  int bEof;
  uint64_t currentValue;
};

static int rb64Connect(
  sqlite3 *db,
  void *pAux,
  int argc, const char *const*argv,
  sqlite3_vtab **ppVtab,
  char **pzErr
){
  rb_vtab *pNew;
  int rc;
  rc = sqlite3_declare_vtab(db, "CREATE TABLE x(value, data hidden)");
  if( rc==SQLITE_OK ){
    pNew = sqlite3_malloc( sizeof(*pNew) );
    *ppVtab = (sqlite3_vtab*)pNew;
    if( pNew==0 ) return SQLITE_NOMEM;
    memset(pNew, 0, sizeof(*pNew));
  }
  return rc;
}

static int rb64Disconnect(sqlite3_vtab *pVtab){
  sqlite3_free(pVtab);
  return SQLITE_OK;
}

static int rb64Open(sqlite3_vtab *p, sqlite3_vtab_cursor **ppCursor){
  rb64_cursor *pCur;
  pCur = sqlite3_malloc( sizeof(*pCur) );
  if( pCur==0 ) return SQLITE_NOMEM;
  memset(pCur, 0, sizeof(*pCur));
  *ppCursor = &pCur->base;
  return SQLITE_OK;
}

static int rb64Close(sqlite3_vtab_cursor *cur){
  rb64_cursor *pCur = (rb64_cursor*)cur;
  if( pCur->pIter ) roaring64_iterator_free(pCur->pIter);
  if( pCur->pBitmap ) roaring64_bitmap_free(pCur->pBitmap);
  sqlite3_free(pCur);
  return SQLITE_OK;
}

static int rb64Next(sqlite3_vtab_cursor *cur){
  rb64_cursor *pCur = (rb64_cursor*)cur;
  if( !pCur->pIter ) return SQLITE_OK;

  roaring64_iterator_advance(pCur->pIter);
  if( roaring64_iterator_has_value(pCur->pIter) ){
    pCur->currentValue = roaring64_iterator_value(pCur->pIter);
    pCur->bEof = 0;
    pCur->iRowid++;
  } else {
    pCur->bEof = 1;
  }
  return SQLITE_OK;
}

static int rb64Column(
  sqlite3_vtab_cursor *cur,
  sqlite3_context *ctx,
  int i
){
  rb64_cursor *pCur = (rb64_cursor*)cur;
  if( i==0 && !pCur->bEof ){
    sqlite3_result_int64(ctx, (sqlite3_int64)pCur->currentValue);
  }
  return SQLITE_OK;
}

static int rb64Rowid(sqlite3_vtab_cursor *cur, sqlite_int64 *pRowid){
  rb64_cursor *pCur = (rb64_cursor*)cur;
  *pRowid = pCur->iRowid;
  return SQLITE_OK;
}

static int rb64Eof(sqlite3_vtab_cursor *cur){
  rb64_cursor *pCur = (rb64_cursor*)cur;
  return pCur->bEof;
}

static int rb64Filter(
  sqlite3_vtab_cursor *pVtabCursor,
  int idxNum, const char *idxStr,
  int argc, sqlite3_value **argv
){
  rb64_cursor *pCur = (rb64_cursor *)pVtabCursor;

  // Cleanup previous run
  if( pCur->pIter ){
    roaring64_iterator_free(pCur->pIter);
    pCur->pIter = NULL;
  }
  if( pCur->pBitmap ){
    roaring64_bitmap_free(pCur->pBitmap);
    pCur->pBitmap = NULL;
  }

  pCur->iRowid = 0;
  pCur->bEof = 1;

  if( argc > 0 ){
    const char *pIn = sqlite3_value_blob(argv[0]);
    unsigned int nIn = sqlite3_value_bytes(argv[0]);
    if( pIn && nIn > 0 ){
        pCur->pBitmap = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
        if( pCur->pBitmap ){
            pCur->pIter = roaring64_iterator_create(pCur->pBitmap);
            if( pCur->pIter && roaring64_iterator_has_value(pCur->pIter) ){
                pCur->currentValue = roaring64_iterator_value(pCur->pIter);
                pCur->bEof = 0;
            }
        }
    }
  }
  return SQLITE_OK;
}

static int rb64BestIndex(
  sqlite3_vtab *tab,
  sqlite3_index_info *pIdxInfo
){
  int i;
  int idxArg = -1;

  for(i=0; i<pIdxInfo->nConstraint; i++){
    if( pIdxInfo->aConstraint[i].iColumn == 1 && pIdxInfo->aConstraint[i].op == SQLITE_INDEX_CONSTRAINT_EQ ){
       if( pIdxInfo->aConstraint[i].usable ){
           idxArg = i;
           break;
       }
    }
  }

  if( idxArg >= 0 ){
    pIdxInfo->aConstraintUsage[idxArg].argvIndex = 1;
    pIdxInfo->aConstraintUsage[idxArg].omit = 1;
    pIdxInfo->estimatedCost = 1.0;
    pIdxInfo->estimatedRows = 100;
  } else {
    pIdxInfo->estimatedCost = 1000000.0;
    pIdxInfo->estimatedRows = 1000000;
  }

  return SQLITE_OK;
}

static sqlite3_module rb64Module = {
  0,                         /* iVersion */
  0,                         /* xCreate */
  rb64Connect,               /* xConnect */
  rb64BestIndex,             /* xBestIndex */
  rb64Disconnect,            /* xDisconnect */
  0,                         /* xDestroy */
  rb64Open,                  /* xOpen - open a cursor */
  rb64Close,                 /* xClose - close a cursor */
  rb64Filter,                /* xFilter - configure scan constraints */
  rb64Next,                  /* xNext - advance a cursor */
  rb64Eof,                   /* xEof - check for end of scan */
  rb64Column,                /* xColumn - read data */
  rb64Rowid,                 /* xRowid - read data */
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
};
#endif /* SQLITE_OMIT_VIRTUALTABLE */


/*********************************************
  rb_count(bitmap)
  --------------------------------------------
  returns the cardinality of the bitmap
*********************************************/
static void roaringLengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring_bitmap_t *r = roaring_bitmap_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  int nSize = roaring_bitmap_get_cardinality(r);
  roaring_bitmap_free(r);
  sqlite3_result_int(context, nSize);
}

static void roaring64LengthFunc(
  sqlite3_context *context,
  int argc,
  sqlite3_value **argv
){
  const char *pIn;
  unsigned int nIn;
  pIn = sqlite3_value_blob(argv[0]);
  nIn = sqlite3_value_bytes(argv[0]);
  roaring64_bitmap_t *r = roaring64_bitmap_portable_deserialize_safe(pIn, nIn);
  if( r == NULL ){
    sqlite3_result_error(context, "invalid bitmap", -1);
    return;
  }
  int64_t nSize = roaring64_bitmap_get_cardinality(r);
  roaring64_bitmap_free(r);
  sqlite3_result_int64(context, nSize);
}

#ifdef _WIN32
__declspec(dllexport)
#endif

int sqlite3_roaring_init(
  sqlite3 *db,
  char **pzErrMsg,
  const sqlite3_api_routines *pApi
){
  int rc = SQLITE_OK;
  SQLITE_EXTENSION_INIT2(pApi);
  int flags = SQLITE_UTF8 | SQLITE_INNOCUOUS | SQLITE_DETERMINISTIC;
  if( pzErrMsg ) *pzErrMsg = 0;
  // Scalar SQL functions
  rc = sqlite3_create_function(db, "rb_create", -1, flags, 0, roaringCreateFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_count", 1, flags, 0, roaringLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_add", 2, flags, 0, roaringAddFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_remove", 2, flags, 0, roaringRemoveFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_and", 2, flags, 0, roaringAndFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_or", 2, flags, 0, roaringOrFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_not", 2, flags, 0, roaringNotFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_xor", 2, flags, 0, roaringXorFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_and_count", 2, flags, 0, roaringAndLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_or_count", 2, flags, 0, roaringOrLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_not_count", 2, flags, 0, roaringNotLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb_xor_count", 2, flags, 0, roaringXorLengthFunc, 0, 0);
  // 64 bit versions
  rc = sqlite3_create_function(db, "rb64_create", -1, flags, 0, roaring64CreateFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_count", 1, flags, 0, roaring64LengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_add", 2, flags, 0, roaring64AddFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_remove", 2, flags, 0, roaring64RemoveFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_and", 2, flags, 0, roaring64AndFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_or", 2, flags, 0, roaring64OrFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_not", 2, flags, 0, roaring64NotFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_xor", 2, flags, 0, roaring64XorFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_and_count", 2, flags, 0, roaring64AndLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_or_count", 2, flags, 0, roaring64OrLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_not_count", 2, flags, 0, roaring64NotLengthFunc, 0, 0);
  rc = sqlite3_create_function(db, "rb64_xor_count", 2, flags, 0, roaring64XorLengthFunc, 0, 0);

  //rc = sqlite3_create_function(db, "rb_and_many", -1, flags, 0, roaringAndManyFunc, 0, 0);
  //rc = sqlite3_create_function(db, "rb_or_many", -1, flags, 0, roaringOrManyFunc, 0, 0);
  // aggregate SQL functions
  rc = sqlite3_create_function(db, "rb_group_create", 1, flags, 0, 0, roaringCreateStep, roaringCreateFinal);
  rc = sqlite3_create_function(db, "rb_group_and", 1, flags, 0, 0, roaringAndAllStep, roaringAndAllFinal);
  rc = sqlite3_create_function(db, "rb_group_or", 1, flags, 0, 0, roaringOrAllStep, roaringOrAllFinal);
  // 64 bit versions
  rc = sqlite3_create_function(db, "rb64_group_create", 1, flags, 0, 0, roaring64CreateStep, roaring64CreateFinal);
  rc = sqlite3_create_function(db, "rb64_group_and", 1, flags, 0, 0, roaring64AndAllStep, roaring64AndAllFinal);
  rc = sqlite3_create_function(db, "rb64_group_or", 1, flags, 0, 0, roaring64OrAllStep, roaring64OrAllFinal);

#ifndef SQLITE_OMIT_VIRTUALTABLE
  // custom virtual tables
  if( (rc = sqlite3_create_module(db, "rb_each", &rbModule, 0)) != SQLITE_OK ){
    return rc;
  }
  if( (rc = sqlite3_create_module(db, "rb64_each", &rb64Module, 0)) != SQLITE_OK ){
    return rc;
  }
#endif

  return SQLITE_OK;
}
