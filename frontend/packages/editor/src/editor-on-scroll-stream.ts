import {eventStream} from "@shm/shared";

export const [dispatchScroll, scrollEvents] = eventStream<any>();
