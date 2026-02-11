// This file declares the wait_for_unlock_notify function.
// See the documentation on Stmt.Step.

#include <sqlite3.h>

#ifdef _WIN32
#include <windows.h>
#else
#include <pthread.h>
#endif

typedef struct unlock_note {
	int fired;
	#ifdef _WIN32
	CONDITION_VARIABLE cond;
	CRITICAL_SECTION mu;
	#else
	pthread_cond_t cond;
	pthread_mutex_t mu;
	#endif
} unlock_note;

unlock_note* unlock_note_alloc();
void unlock_note_fire(unlock_note* un);
void unlock_note_free(unlock_note* un);

int wait_for_unlock_notify(sqlite3 *db, unlock_note* un);
