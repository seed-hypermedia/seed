# XState v5 Examples

> **XState v5 ONLY** - Do not use v4 patterns. Requires TypeScript 5.0+.

## 1. Toggle Machine

Simple on/off toggle with TypeScript.

```typescript
// toggle.machine.ts
import { setup } from 'xstate';

export const toggleMachine = setup({
  types: {
    events: {} as { type: 'TOGGLE' },
  },
}).createMachine({
  id: 'toggle',
  initial: 'inactive',
  states: {
    inactive: {
      on: { TOGGLE: 'active' },
    },
    active: {
      on: { TOGGLE: 'inactive' },
    },
  },
});

// Toggle.tsx
import { useMachine } from '@xstate/react';
import { toggleMachine } from './toggle.machine';

export function Toggle() {
  const [snapshot, send] = useMachine(toggleMachine);
  const isActive = snapshot.matches('active');

  return (
    <button
      onClick={() => send({ type: 'TOGGLE' })}
      className={isActive ? 'bg-green-500' : 'bg-gray-300'}
    >
      {isActive ? 'ON' : 'OFF'}
    </button>
  );
}
```

## 2. Form Validation Machine

Multi-field form with validation states.

```typescript
// form.machine.ts
import { setup, assign } from 'xstate';

interface FormContext {
  fields: {
    email: string;
    password: string;
  };
  errors: {
    email?: string;
    password?: string;
  };
  touched: {
    email: boolean;
    password: boolean;
  };
}

type FormEvents =
  | { type: 'CHANGE'; field: 'email' | 'password'; value: string }
  | { type: 'BLUR'; field: 'email' | 'password' }
  | { type: 'SUBMIT' }
  | { type: 'RESET' };

const validateEmail = (email: string) => {
  if (!email) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email';
  return undefined;
};

const validatePassword = (password: string) => {
  if (!password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  return undefined;
};

export const formMachine = setup({
  types: {
    context: {} as FormContext,
    events: {} as FormEvents,
  },
  actions: {
    updateField: assign({
      fields: ({ context, event }) => {
        if (event.type !== 'CHANGE') return context.fields;
        return { ...context.fields, [event.field]: event.value };
      },
    }),
    validateField: assign({
      errors: ({ context, event }) => {
        if (event.type !== 'BLUR' && event.type !== 'CHANGE') return context.errors;
        const field = event.type === 'BLUR' ? event.field : (event as { field: string }).field;
        const value = context.fields[field as keyof typeof context.fields];
        const error = field === 'email' ? validateEmail(value) : validatePassword(value);
        return { ...context.errors, [field]: error };
      },
    }),
    markTouched: assign({
      touched: ({ context, event }) => {
        if (event.type !== 'BLUR') return context.touched;
        return { ...context.touched, [event.field]: true };
      },
    }),
    resetForm: assign({
      fields: { email: '', password: '' },
      errors: {},
      touched: { email: false, password: false },
    }),
  },
  guards: {
    isFormValid: ({ context }) => {
      const emailError = validateEmail(context.fields.email);
      const passwordError = validatePassword(context.fields.password);
      return !emailError && !passwordError;
    },
  },
}).createMachine({
  id: 'form',
  initial: 'editing',
  context: {
    fields: { email: '', password: '' },
    errors: {},
    touched: { email: false, password: false },
  },
  states: {
    editing: {
      on: {
        CHANGE: { actions: ['updateField', 'validateField'] },
        BLUR: { actions: ['markTouched', 'validateField'] },
        SUBMIT: { guard: 'isFormValid', target: 'submitting' },
        RESET: { actions: 'resetForm' },
      },
    },
    submitting: {
      invoke: {
        src: 'submitForm',
        onDone: 'success',
        onError: 'editing',
      },
    },
    success: {
      on: { RESET: { target: 'editing', actions: 'resetForm' } },
    },
  },
});

// Form.tsx
import { useMachine } from '@xstate/react';
import { formMachine } from './form.machine';

export function LoginForm() {
  const [snapshot, send] = useMachine(formMachine);
  const { fields, errors, touched } = snapshot.context;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send({ type: 'SUBMIT' });
  };

  if (snapshot.matches('success')) {
    return (
      <div>
        <p>Success!</p>
        <button onClick={() => send({ type: 'RESET' })}>Reset</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          type="email"
          value={fields.email}
          onChange={(e) => send({ type: 'CHANGE', field: 'email', value: e.target.value })}
          onBlur={() => send({ type: 'BLUR', field: 'email' })}
          placeholder="Email"
        />
        {touched.email && errors.email && <span className="error">{errors.email}</span>}
      </div>

      <div>
        <input
          type="password"
          value={fields.password}
          onChange={(e) => send({ type: 'CHANGE', field: 'password', value: e.target.value })}
          onBlur={() => send({ type: 'BLUR', field: 'password' })}
          placeholder="Password"
        />
        {touched.password && errors.password && <span className="error">{errors.password}</span>}
      </div>

      <button type="submit" disabled={snapshot.matches('submitting')}>
        {snapshot.matches('submitting') ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

## 3. Async Data Fetching Machine

Fetch data with loading, error, and retry states.

```typescript
// fetch.machine.ts
import { setup, assign, fromPromise } from 'xstate';

interface FetchContext<T> {
  data: T | null;
  error: string | null;
}

type FetchEvents = { type: 'FETCH' } | { type: 'RETRY' } | { type: 'RESET' };

export function createFetchMachine<T>(fetcher: () => Promise<T>) {
  return setup({
    types: {
      context: {} as FetchContext<T>,
      events: {} as FetchEvents,
    },
    actors: {
      fetchData: fromPromise(async () => fetcher()),
    },
    actions: {
      setData: assign({ data: (_, params: { data: T }) => params.data, error: null }),
      setError: assign({ error: (_, params: { error: string }) => params.error }),
      reset: assign({ data: null, error: null }),
    },
  }).createMachine({
    id: 'fetch',
    initial: 'idle',
    context: { data: null, error: null },
    states: {
      idle: {
        on: { FETCH: 'loading' },
      },
      loading: {
        invoke: {
          src: 'fetchData',
          onDone: {
            target: 'success',
            actions: { type: 'setData', params: ({ event }) => ({ data: event.output }) },
          },
          onError: {
            target: 'error',
            actions: { type: 'setError', params: ({ event }) => ({ error: String(event.error) }) },
          },
        },
      },
      success: {
        on: {
          FETCH: 'loading',
          RESET: { target: 'idle', actions: 'reset' },
        },
      },
      error: {
        on: {
          RETRY: 'loading',
          RESET: { target: 'idle', actions: 'reset' },
        },
      },
    },
  });
}

// UserList.tsx
import { useMachine } from '@xstate/react';
import { createFetchMachine } from './fetch.machine';

interface User {
  id: string;
  name: string;
}

const userFetchMachine = createFetchMachine<User[]>(async () => {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error('Failed to fetch');
  return res.json();
});

export function UserList() {
  const [snapshot, send] = useMachine(userFetchMachine);

  React.useEffect(() => {
    send({ type: 'FETCH' });
  }, [send]);

  if (snapshot.matches('loading')) {
    return <div>Loading...</div>;
  }

  if (snapshot.matches('error')) {
    return (
      <div>
        <p>Error: {snapshot.context.error}</p>
        <button onClick={() => send({ type: 'RETRY' })}>Retry</button>
      </div>
    );
  }

  if (snapshot.matches('success') && snapshot.context.data) {
    return (
      <ul>
        {snapshot.context.data.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    );
  }

  return <button onClick={() => send({ type: 'FETCH' })}>Load Users</button>;
}
```

## 4. Multi-Step Wizard Machine

Step-by-step wizard with back/next navigation.

```typescript
// wizard.machine.ts
import { setup, assign } from 'xstate';

interface WizardContext {
  step1Data: { name: string } | null;
  step2Data: { email: string } | null;
  step3Data: { plan: string } | null;
}

type WizardEvents =
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SET_STEP1'; data: { name: string } }
  | { type: 'SET_STEP2'; data: { email: string } }
  | { type: 'SET_STEP3'; data: { plan: string } }
  | { type: 'SUBMIT' }
  | { type: 'RESET' };

export const wizardMachine = setup({
  types: {
    context: {} as WizardContext,
    events: {} as WizardEvents,
  },
  actions: {
    setStep1: assign({ step1Data: (_, params: { data: { name: string } }) => params.data }),
    setStep2: assign({ step2Data: (_, params: { data: { email: string } }) => params.data }),
    setStep3: assign({ step3Data: (_, params: { data: { plan: string } }) => params.data }),
    resetWizard: assign({ step1Data: null, step2Data: null, step3Data: null }),
  },
  guards: {
    hasStep1Data: ({ context }) => context.step1Data !== null,
    hasStep2Data: ({ context }) => context.step2Data !== null,
    hasStep3Data: ({ context }) => context.step3Data !== null,
  },
}).createMachine({
  id: 'wizard',
  initial: 'step1',
  context: { step1Data: null, step2Data: null, step3Data: null },
  states: {
    step1: {
      on: {
        SET_STEP1: { actions: { type: 'setStep1', params: ({ event }) => ({ data: event.data }) } },
        NEXT: { guard: 'hasStep1Data', target: 'step2' },
      },
    },
    step2: {
      on: {
        SET_STEP2: { actions: { type: 'setStep2', params: ({ event }) => ({ data: event.data }) } },
        NEXT: { guard: 'hasStep2Data', target: 'step3' },
        BACK: 'step1',
      },
    },
    step3: {
      on: {
        SET_STEP3: { actions: { type: 'setStep3', params: ({ event }) => ({ data: event.data }) } },
        SUBMIT: { guard: 'hasStep3Data', target: 'submitting' },
        BACK: 'step2',
      },
    },
    submitting: {
      invoke: {
        src: 'submitWizard',
        onDone: 'complete',
        onError: 'step3',
      },
    },
    complete: {
      on: { RESET: { target: 'step1', actions: 'resetWizard' } },
    },
  },
});

// Wizard.tsx
import { useMachine } from '@xstate/react';
import { wizardMachine } from './wizard.machine';

export function Wizard() {
  const [snapshot, send] = useMachine(wizardMachine);

  const currentStep = snapshot.value as string;

  return (
    <div>
      <div className="progress">
        Step {currentStep.replace('step', '')} of 3
      </div>

      {snapshot.matches('step1') && (
        <Step1
          data={snapshot.context.step1Data}
          onSubmit={(data) => {
            send({ type: 'SET_STEP1', data });
            send({ type: 'NEXT' });
          }}
        />
      )}

      {snapshot.matches('step2') && (
        <Step2
          data={snapshot.context.step2Data}
          onSubmit={(data) => {
            send({ type: 'SET_STEP2', data });
            send({ type: 'NEXT' });
          }}
          onBack={() => send({ type: 'BACK' })}
        />
      )}

      {snapshot.matches('step3') && (
        <Step3
          data={snapshot.context.step3Data}
          onSubmit={(data) => {
            send({ type: 'SET_STEP3', data });
            send({ type: 'SUBMIT' });
          }}
          onBack={() => send({ type: 'BACK' })}
        />
      )}

      {snapshot.matches('submitting') && <div>Submitting...</div>}

      {snapshot.matches('complete') && (
        <div>
          <h2>Complete!</h2>
          <button onClick={() => send({ type: 'RESET' })}>Start Over</button>
        </div>
      )}
    </div>
  );
}
```

## 5. Modal Machine

Reusable modal with open/close and confirmation states.

```typescript
// modal.machine.ts
import { setup } from 'xstate';

type ModalEvents =
  | { type: 'OPEN' }
  | { type: 'CLOSE' }
  | { type: 'CONFIRM' }
  | { type: 'CANCEL' };

export const modalMachine = setup({
  types: {
    events: {} as ModalEvents,
  },
}).createMachine({
  id: 'modal',
  initial: 'closed',
  states: {
    closed: {
      on: { OPEN: 'open' },
    },
    open: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            CONFIRM: 'confirming',
            CANCEL: '#modal.closed',
          },
        },
        confirming: {
          invoke: {
            src: 'confirmAction',
            onDone: '#modal.closed',
            onError: 'idle',
          },
        },
      },
      on: {
        CLOSE: 'closed',
      },
    },
  },
});

// ConfirmModal.tsx
import { useMachine } from '@xstate/react';
import { modalMachine } from './modal.machine';

interface Props {
  onConfirm: () => Promise<void>;
  trigger: React.ReactNode;
  children: React.ReactNode;
}

export function ConfirmModal({ onConfirm, trigger, children }: Props) {
  const [snapshot, send] = useMachine(modalMachine, {
    actors: {
      confirmAction: fromPromise(onConfirm),
    },
  });

  const isOpen = snapshot.matches('open');
  const isConfirming = snapshot.matches({ open: 'confirming' });

  return (
    <>
      <span onClick={() => send({ type: 'OPEN' })}>{trigger}</span>

      {isOpen && (
        <div className="modal-overlay">
          <div className="modal">
            {children}
            <div className="modal-actions">
              <button onClick={() => send({ type: 'CANCEL' })} disabled={isConfirming}>
                Cancel
              </button>
              <button onClick={() => send({ type: 'CONFIRM' })} disabled={isConfirming}>
                {isConfirming ? 'Confirming...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```