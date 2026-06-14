CC ?= cc
CFLAGS ?= -std=c11 -O2 -Wall -Wextra -Werror
LDFLAGS ?=

.PHONY: all clean

all: linux-evdev-helper linux-evdev-helper-debug

linux-evdev-helper: linux-evdev-helper.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)

linux-evdev-helper-debug: linux-evdev-helper.c
	$(CC) $(CFLAGS) -DEE2_HELPER_DEBUG_EVENTS=1 -o $@ $< $(LDFLAGS)

clean:
	rm -f linux-evdev-helper linux-evdev-helper-debug
