#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define MAX_DEVICES 128
#define MAX_HOTKEYS 128
#define MAX_TEXT 256
#define MAX_JSON (1024 * 1024)
#define PARENT_CHECK_INTERVAL_MS 60000LL

typedef struct {
    char path[MAX_TEXT];
    int fd;
} Device;

typedef struct {
    bool ctrl;
    bool shift;
    bool alt;
    bool meta;
} Modifiers;

typedef struct {
    char id[MAX_TEXT];
    char accelerator[MAX_TEXT];
    int key_code;
    Modifiers required;
} Hotkey;

typedef struct {
    pid_t parent_pid;
    Device devices[MAX_DEVICES];
    size_t device_count;
    Hotkey hotkeys[MAX_HOTKEYS];
    size_t hotkey_count;
    bool enable_uinput;
} Config;

static volatile sig_atomic_t stop_requested = 0;

static void handle_signal(int signal_number) {
    (void)signal_number;
    stop_requested = 1;
}

static void emit_escaped(const char *text) {
    fputc('"', stdout);
    for (const unsigned char *p = (const unsigned char *)text; *p != '\0'; p++) {
        if (*p == '"' || *p == '\\') {
            fputc('\\', stdout);
            fputc((int)*p, stdout);
        } else if (*p == '\n') {
            fputs("\\n", stdout);
        } else if (*p == '\r') {
            fputs("\\r", stdout);
        } else if (*p == '\t') {
            fputs("\\t", stdout);
        } else if (*p < 0x20) {
            fprintf(stdout, "\\u%04x", *p);
        } else {
            fputc((int)*p, stdout);
        }
    }
    fputc('"', stdout);
}

static void emit_error(const char *code, const char *message, const char *detail) {
    fputs("{\"type\":\"error\",\"code\":", stdout);
    emit_escaped(code);
    fputs(",\"message\":", stdout);
    emit_escaped(message);
    if (detail != NULL) {
        fputs(",\"detail\":", stdout);
        emit_escaped(detail);
    }
    fputs("}\n", stdout);
    fflush(stdout);
}

static void emit_ready(const Config *config) {
    fputs("{\"type\":\"ready\",\"devices\":[", stdout);
    for (size_t i = 0; i < config->device_count; i++) {
        if (i > 0) {
            fputc(',', stdout);
        }
        emit_escaped(config->devices[i].path);
    }
    fprintf(stdout, "],\"hotkeys\":%zu}\n", config->hotkey_count);
    fflush(stdout);
}

static void emit_configured(const Config *config) {
    fprintf(stdout, "{\"type\":\"configured\",\"hotkeys\":%zu}\n", config->hotkey_count);
    fflush(stdout);
}

static long long now_ms(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        return 0;
    }
    return ((long long)ts.tv_sec * 1000LL) + ((long long)ts.tv_nsec / 1000000LL);
}

static void emit_hotkey(const Hotkey *hotkey) {
    fputs("{\"type\":\"hotkey\",\"id\":", stdout);
    emit_escaped(hotkey->id);
    fputs(",\"accelerator\":", stdout);
    emit_escaped(hotkey->accelerator);
    fprintf(stdout, ",\"timestamp\":%lld}\n", now_ms());
    fflush(stdout);
}

static void skip_ws(const char **p) {
    while (**p == ' ' || **p == '\n' || **p == '\r' || **p == '\t') {
        (*p)++;
    }
}

static bool parse_json_string(const char **p, char *out, size_t out_size) {
    size_t len = 0;
    skip_ws(p);
    if (**p != '"') {
        return false;
    }
    (*p)++;
    while (**p != '\0' && **p != '"') {
        unsigned char ch = (unsigned char)**p;
        if (ch == '\\') {
            (*p)++;
            ch = (unsigned char)**p;
            if (ch == '\0') {
                return false;
            }
            if (ch == 'n') {
                ch = '\n';
            } else if (ch == 'r') {
                ch = '\r';
            } else if (ch == 't') {
                ch = '\t';
            } else if (ch == 'u') {
                return false;
            }
        }
        if (len + 1 >= out_size) {
            return false;
        }
        out[len++] = (char)ch;
        (*p)++;
    }
    if (**p != '"') {
        return false;
    }
    (*p)++;
    out[len] = '\0';
    return true;
}

static const char *find_key(const char *json, const char *key) {
    char needle[64];
    int written = snprintf(needle, sizeof(needle), "\"%s\"", key);
    if (written < 0 || (size_t)written >= sizeof(needle)) {
        return NULL;
    }
    const char *p = strstr(json, needle);
    if (p == NULL) {
        return NULL;
    }
    p += strlen(needle);
    skip_ws(&p);
    if (*p != ':') {
        return NULL;
    }
    p++;
    skip_ws(&p);
    return p;
}

static bool parse_bool_field(const char *json, const char *key, bool *value) {
    const char *p = find_key(json, key);
    if (p == NULL) {
        return false;
    }
    if (strncmp(p, "false", 5) == 0) {
        *value = false;
        return true;
    }
    if (strncmp(p, "true", 4) == 0) {
        *value = true;
        return true;
    }
    return false;
}

static bool parse_pid_field(const char *json, pid_t *pid) {
    const char *p = find_key(json, "parentPid");
    char *end = NULL;
    long parsed;
    if (p == NULL) {
        return false;
    }
    errno = 0;
    parsed = strtol(p, &end, 10);
    if (errno != 0 || end == p || parsed <= 1) {
        return false;
    }
    *pid = (pid_t)parsed;
    return true;
}

static bool parse_devices(const char *json, Config *config) {
    const char *p = find_key(json, "devices");
    if (p == NULL || *p != '[') {
        return false;
    }
    p++;
    skip_ws(&p);
    while (*p != ']') {
        if (config->device_count >= MAX_DEVICES) {
            return false;
        }
        if (!parse_json_string(&p, config->devices[config->device_count].path, sizeof(config->devices[config->device_count].path))) {
            return false;
        }
        config->devices[config->device_count].fd = -1;
        config->device_count++;
        skip_ws(&p);
        if (*p == ',') {
            p++;
            skip_ws(&p);
        } else if (*p != ']') {
            return false;
        }
    }
    return config->device_count > 0;
}

static int key_code_from_name(const char *name) {
    if (strncmp(name, "KEY_", 4) == 0 && name[4] >= 'A' && name[4] <= 'Z' && name[5] == '\0') {
        static const int letter_codes[26] = {
            KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F, KEY_G, KEY_H, KEY_I, KEY_J, KEY_K, KEY_L, KEY_M,
            KEY_N, KEY_O, KEY_P, KEY_Q, KEY_R, KEY_S, KEY_T, KEY_U, KEY_V, KEY_W, KEY_X, KEY_Y, KEY_Z
        };
        return letter_codes[name[4] - 'A'];
    }
    if (strncmp(name, "KEY_F", 5) == 0) {
        char *end = NULL;
        long number = strtol(name + 5, &end, 10);
        if (end != name + 5 && *end == '\0' && number >= 1 && number <= 12) {
            return KEY_F1 + (int)(number - 1);
        }
    }
    if (strncmp(name, "KEY_KP", 6) == 0 && name[6] >= '0' && name[6] <= '9' && name[7] == '\0') {
        return KEY_KP0 + (name[6] - '0');
    }
    if (strcmp(name, "KEY_SPACE") == 0) {
        return KEY_SPACE;
    }
    if (strcmp(name, "KEY_TAB") == 0) {
        return KEY_TAB;
    }
    if (strcmp(name, "KEY_HOME") == 0) {
        return KEY_HOME;
    }
    if (strcmp(name, "KEY_END") == 0) {
        return KEY_END;
    }
    if (strcmp(name, "KEY_PAGEUP") == 0) {
        return KEY_PAGEUP;
    }
    if (strcmp(name, "KEY_PAGEDOWN") == 0) {
        return KEY_PAGEDOWN;
    }
    if (strcmp(name, "KEY_INSERT") == 0) {
        return KEY_INSERT;
    }
    if (strcmp(name, "KEY_DELETE") == 0) {
        return KEY_DELETE;
    }
    if (strcmp(name, "KEY_ESC") == 0) {
        return KEY_ESC;
    }
    if (strcmp(name, "KEY_ENTER") == 0) {
        return KEY_ENTER;
    }
    if (strcmp(name, "KEY_BACKSPACE") == 0) {
        return KEY_BACKSPACE;
    }
    if (strcmp(name, "KEY_DOT") == 0) {
        return KEY_DOT;
    }
    if (strcmp(name, "KEY_UP") == 0) {
        return KEY_UP;
    }
    if (strcmp(name, "KEY_DOWN") == 0) {
        return KEY_DOWN;
    }
    if (strcmp(name, "KEY_LEFT") == 0) {
        return KEY_LEFT;
    }
    if (strcmp(name, "KEY_RIGHT") == 0) {
        return KEY_RIGHT;
    }
    if (strcmp(name, "KEY_KPPLUS") == 0) {
        return KEY_KPPLUS;
    }
    if (strcmp(name, "KEY_KPMINUS") == 0) {
        return KEY_KPMINUS;
    }
    if (strcmp(name, "KEY_KPASTERISK") == 0) {
        return KEY_KPASTERISK;
    }
    if (strcmp(name, "KEY_KPSLASH") == 0) {
        return KEY_KPSLASH;
    }
    if (strcmp(name, "KEY_KPENTER") == 0) {
        return KEY_KPENTER;
    }
    if (strcmp(name, "KEY_KPDOT") == 0) {
        return KEY_KPDOT;
    }
    if (strcmp(name, "BTN_LEFT") == 0) {
        return BTN_LEFT;
    }
    if (strcmp(name, "BTN_RIGHT") == 0) {
        return BTN_RIGHT;
    }
    if (strcmp(name, "BTN_MIDDLE") == 0) {
        return BTN_MIDDLE;
    }
    if (strcmp(name, "BTN_SIDE") == 0) {
        return BTN_SIDE;
    }
    if (strcmp(name, "BTN_EXTRA") == 0) {
        return BTN_EXTRA;
    }
    return -1;
}

static bool parse_modifier_array(const char *object, Modifiers *modifiers) {
    const char *p = find_key(object, "modifiers");
    char value[MAX_TEXT];
    if (p == NULL || *p != '[') {
        return false;
    }
    p++;
    skip_ws(&p);
    while (*p != ']') {
        if (!parse_json_string(&p, value, sizeof(value))) {
            return false;
        }
        if (strcmp(value, "ctrl") == 0) {
            modifiers->ctrl = true;
        } else if (strcmp(value, "shift") == 0) {
            modifiers->shift = true;
        } else if (strcmp(value, "alt") == 0) {
            modifiers->alt = true;
        } else if (strcmp(value, "meta") == 0) {
            modifiers->meta = true;
        } else {
            return false;
        }
        skip_ws(&p);
        if (*p == ',') {
            p++;
            skip_ws(&p);
        } else if (*p != ']') {
            return false;
        }
    }
    return true;
}

static bool parse_hotkey_object(const char *object, Hotkey *hotkey) {
    const char *p;
    char key_code_name[MAX_TEXT];
    memset(hotkey, 0, sizeof(*hotkey));
    p = find_key(object, "id");
    if (p == NULL || !parse_json_string(&p, hotkey->id, sizeof(hotkey->id))) {
        return false;
    }
    p = find_key(object, "accelerator");
    if (p == NULL || !parse_json_string(&p, hotkey->accelerator, sizeof(hotkey->accelerator))) {
        return false;
    }
    p = find_key(object, "keyCode");
    if (p == NULL || !parse_json_string(&p, key_code_name, sizeof(key_code_name))) {
        return false;
    }
    hotkey->key_code = key_code_from_name(key_code_name);
    if (hotkey->key_code < 0) {
        return false;
    }
    return parse_modifier_array(object, &hotkey->required);
}

static bool parse_hotkeys(const char *json, Config *config) {
    const char *p = find_key(json, "hotkeys");
    config->hotkey_count = 0;
    if (p == NULL || *p != '[') {
        return false;
    }
    p++;
    skip_ws(&p);
    while (*p != ']') {
        const char *start;
        int depth = 0;
        char object[4096];
        size_t len;
        if (config->hotkey_count >= MAX_HOTKEYS || *p != '{') {
            return false;
        }
        start = p;
        do {
            if (*p == '\0') {
                return false;
            }
            if (*p == '{') {
                depth++;
            } else if (*p == '}') {
                depth--;
            }
            p++;
        } while (depth > 0);
        len = (size_t)(p - start);
        if (len >= sizeof(object)) {
            return false;
        }
        memcpy(object, start, len);
        object[len] = '\0';
        if (!parse_hotkey_object(object, &config->hotkeys[config->hotkey_count])) {
            return false;
        }
        config->hotkey_count++;
        skip_ws(&p);
        if (*p == ',') {
            p++;
            skip_ws(&p);
        } else if (*p != ']') {
            return false;
        }
    }
    return true;
}

static bool read_stdin_line(char **json_out) {
    size_t capacity = 8192;
    size_t used = 0;
    char *buffer = malloc(capacity);
    if (buffer == NULL) {
        return false;
    }
    for (;;) {
        ssize_t nread;
        if (used + 4096 + 1 > capacity) {
            char *next;
            capacity *= 2;
            if (capacity > MAX_JSON) {
                free(buffer);
                return false;
            }
            next = realloc(buffer, capacity);
            if (next == NULL) {
                free(buffer);
                return false;
            }
            buffer = next;
        }
        nread = read(STDIN_FILENO, buffer + used, capacity - used - 1);
        if (nread < 0) {
            if (errno == EINTR) {
                continue;
            }
            free(buffer);
            return false;
        }
        if (nread == 0) {
            break;
        }
        used += (size_t)nread;
        if (memchr(buffer, '\n', used) != NULL) {
            break;
        }
    }
    buffer[used] = '\0';
    *json_out = buffer;
    return used > 0;
}

static bool parse_config(const char *json, Config *config) {
    memset(config, 0, sizeof(*config));
    for (size_t i = 0; i < MAX_DEVICES; i++) {
        config->devices[i].fd = -1;
    }
    return parse_pid_field(json, &config->parent_pid) &&
           parse_devices(json, config) &&
           parse_hotkeys(json, config) &&
           parse_bool_field(json, "enableUinput", &config->enable_uinput) &&
           config->enable_uinput == false;
}

static bool extract_object_field(const char *json, const char *key, char *out, size_t out_size) {
    const char *p = find_key(json, key);
    const char *start;
    int depth = 0;
    size_t len;
    if (p == NULL || *p != '{') {
        return false;
    }
    start = p;
    do {
        if (*p == '\0') {
            return false;
        }
        if (*p == '{') {
            depth++;
        } else if (*p == '}') {
            depth--;
        }
        p++;
    } while (depth > 0);
    len = (size_t)(p - start);
    if (len >= out_size) {
        return false;
    }
    memcpy(out, start, len);
    out[len] = '\0';
    return true;
}

static bool replace_hotkeys(Config *config, const Hotkey *hotkeys, size_t hotkey_count) {
    if (hotkey_count > MAX_HOTKEYS) {
        return false;
    }
    memcpy(config->hotkeys, hotkeys, hotkey_count * sizeof(Hotkey));
    config->hotkey_count = hotkey_count;
    return true;
}

static bool bind_hotkey(Config *config, const Hotkey *hotkey) {
    for (size_t i = 0; i < config->hotkey_count; i++) {
        if (strcmp(config->hotkeys[i].id, hotkey->id) == 0) {
            config->hotkeys[i] = *hotkey;
            return true;
        }
    }
    if (config->hotkey_count >= MAX_HOTKEYS) {
        return false;
    }
    config->hotkeys[config->hotkey_count++] = *hotkey;
    return true;
}

static bool unbind_hotkey(Config *config, const char *id) {
    for (size_t i = 0; i < config->hotkey_count; i++) {
        if (strcmp(config->hotkeys[i].id, id) == 0) {
            for (size_t j = i + 1; j < config->hotkey_count; j++) {
                config->hotkeys[j - 1] = config->hotkeys[j];
            }
            config->hotkey_count--;
            return true;
        }
    }
    return true;
}

static bool apply_command(Config *config, const char *line) {
    const char *p = find_key(line, "type");
    char type[MAX_TEXT];
    if (p == NULL || !parse_json_string(&p, type, sizeof(type))) {
        emit_error("COMMAND_INVALID", "runtime command is missing a valid type", NULL);
        return true;
    }

    if (strcmp(type, "bind") == 0) {
        char object[4096];
        Hotkey hotkey;
        if (!extract_object_field(line, "hotkey", object, sizeof(object)) || !parse_hotkey_object(object, &hotkey)) {
            emit_error("COMMAND_INVALID", "bind command is missing a valid hotkey", NULL);
            return true;
        }
        if (!bind_hotkey(config, &hotkey)) {
            emit_error("TOO_MANY_HOTKEYS", "cannot bind more hotkeys", NULL);
            return true;
        }
        emit_configured(config);
        return true;
    }

    if (strcmp(type, "unbind") == 0) {
        char id[MAX_TEXT];
        p = find_key(line, "id");
        if (p == NULL || !parse_json_string(&p, id, sizeof(id)) || id[0] == '\0') {
            emit_error("COMMAND_INVALID", "unbind command is missing a valid id", NULL);
            return true;
        }
        unbind_hotkey(config, id);
        emit_configured(config);
        return true;
    }

    if (strcmp(type, "clear") == 0) {
        config->hotkey_count = 0;
        emit_configured(config);
        return true;
    }

    if (strcmp(type, "set") == 0) {
        Config next;
        memset(&next, 0, sizeof(next));
        if (!parse_hotkeys(line, &next)) {
            emit_error("COMMAND_INVALID", "set command is missing valid hotkeys", NULL);
            return true;
        }
        replace_hotkeys(config, next.hotkeys, next.hotkey_count);
        emit_configured(config);
        return true;
    }

    emit_error("COMMAND_UNSUPPORTED", "runtime command type is not supported", type);
    return true;
}

static void close_devices(Config *config) {
    for (size_t i = 0; i < config->device_count; i++) {
        if (config->devices[i].fd >= 0) {
            close(config->devices[i].fd);
            config->devices[i].fd = -1;
        }
    }
}

static bool open_devices(Config *config) {
    for (size_t i = 0; i < config->device_count; i++) {
        int fd = open(config->devices[i].path, O_RDONLY | O_CLOEXEC);
        if (fd < 0) {
            emit_error("OPEN_DEVICE_FAILED", "failed to open evdev device", config->devices[i].path);
            close_devices(config);
            return false;
        }
        config->devices[i].fd = fd;
    }
    return true;
}

static void update_key_counts(int *key_counts, int code, int value) {
    if (code < 0 || code >= KEY_CNT) {
        return;
    }
    if (value == 1) {
        key_counts[code]++;
    } else if (value == 0 && key_counts[code] > 0) {
        key_counts[code]--;
    }
}

static Modifiers current_modifiers(const int *key_counts) {
    Modifiers modifiers = {0};
    modifiers.ctrl = key_counts[KEY_LEFTCTRL] > 0 || key_counts[KEY_RIGHTCTRL] > 0;
    modifiers.shift = key_counts[KEY_LEFTSHIFT] > 0 || key_counts[KEY_RIGHTSHIFT] > 0;
    modifiers.alt = key_counts[KEY_LEFTALT] > 0 || key_counts[KEY_RIGHTALT] > 0;
    modifiers.meta = key_counts[KEY_LEFTMETA] > 0 || key_counts[KEY_RIGHTMETA] > 0;
    return modifiers;
}

static bool modifiers_match(Modifiers current, Modifiers required) {
    return (!required.ctrl || current.ctrl) &&
           (!required.shift || current.shift) &&
           (!required.alt || current.alt) &&
           (!required.meta || current.meta);
}

static void handle_key_event(Config *config, int *key_counts, int code, int value) {
    if (value == 2) {
        return;
    }
    if (value == 0) {
        update_key_counts(key_counts, code, value);
        return;
    }
    if (value != 1) {
        return;
    }

    update_key_counts(key_counts, code, value);
    Modifiers modifiers = current_modifiers(key_counts);

#ifdef EE2_HELPER_DEBUG_EVENTS
    fprintf(stderr, "EV_KEY code=%d value=%d ctrl=%d shift=%d alt=%d meta=%d\n",
            code, value, modifiers.ctrl, modifiers.shift, modifiers.alt, modifiers.meta);
#endif

    for (size_t i = 0; i < config->hotkey_count; i++) {
        if (config->hotkeys[i].key_code == code && modifiers_match(modifiers, config->hotkeys[i].required)) {
            emit_hotkey(&config->hotkeys[i]);
        }
    }
}

static bool parent_is_alive(pid_t parent_pid) {
    if (kill(parent_pid, 0) == 0) {
        return true;
    }
    return errno != ESRCH;
}

static bool handle_stdin_data(Config *config, char *buffer, size_t *used, bool *stdin_open) {
    char chunk[4096];
    ssize_t nread = read(STDIN_FILENO, chunk, sizeof(chunk));
    if (nread < 0) {
        if (errno == EINTR || errno == EAGAIN) {
            return true;
        }
        emit_error("COMMAND_READ_FAILED", "failed to read runtime command", strerror(errno));
        return true;
    }
    if (nread == 0) {
        *stdin_open = false;
        return true;
    }
    if (*used + (size_t)nread >= MAX_JSON) {
        *used = 0;
        emit_error("COMMAND_TOO_LARGE", "runtime command exceeded maximum size", NULL);
        return true;
    }
    memcpy(buffer + *used, chunk, (size_t)nread);
    *used += (size_t)nread;
    buffer[*used] = '\0';

    for (;;) {
        char *newline = memchr(buffer, '\n', *used);
        size_t line_len;
        if (newline == NULL) {
            break;
        }
        line_len = (size_t)(newline - buffer);
        if (line_len > 0) {
            char line[MAX_JSON];
            memcpy(line, buffer, line_len);
            line[line_len] = '\0';
            apply_command(config, line);
        }
        memmove(buffer, newline + 1, *used - line_len - 1);
        *used -= line_len + 1;
        buffer[*used] = '\0';
    }
    return true;
}

static int run(Config *config) {
    struct pollfd fds[MAX_DEVICES + 1];
    int key_counts[KEY_CNT] = {0};
    char command_buffer[MAX_JSON];
    size_t command_buffer_used = 0;
    bool stdin_open = true;
    long long last_parent_check_ms = now_ms() - PARENT_CHECK_INTERVAL_MS;
    fds[0].fd = STDIN_FILENO;
    fds[0].events = POLLIN;
    fds[0].revents = 0;
    for (size_t i = 0; i < config->device_count; i++) {
        fds[i + 1].fd = config->devices[i].fd;
        fds[i + 1].events = POLLIN;
        fds[i + 1].revents = 0;
    }
    command_buffer[0] = '\0';

    emit_ready(config);

    while (!stop_requested) {
        long long current_ms = now_ms();
        if (current_ms - last_parent_check_ms >= PARENT_CHECK_INTERVAL_MS) {
            last_parent_check_ms = current_ms;
            if (!parent_is_alive(config->parent_pid)) {
                return 0;
            }
        }
        fds[0].fd = stdin_open ? STDIN_FILENO : -1;
        int ready = poll(fds, config->device_count + 1, 1000);
        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }
            emit_error("POLL_FAILED", "poll failed", strerror(errno));
            return 1;
        }
        if (ready == 0) {
            continue;
        }
        if (stdin_open && (fds[0].revents & POLLIN) != 0) {
            handle_stdin_data(config, command_buffer, &command_buffer_used, &stdin_open);
        }
        if (stdin_open && (fds[0].revents & (POLLHUP | POLLNVAL)) != 0) {
            stdin_open = false;
        }
        for (size_t i = 0; i < config->device_count; i++) {
            size_t fd_index = i + 1;
            if ((fds[fd_index].revents & (POLLERR | POLLHUP | POLLNVAL)) != 0) {
                emit_error("DEVICE_POLL_FAILED", "evdev device became unreadable", config->devices[i].path);
                return 1;
            }
            if ((fds[fd_index].revents & POLLIN) != 0) {
                struct input_event event;
                ssize_t nread = read(fds[fd_index].fd, &event, sizeof(event));
                if (nread != (ssize_t)sizeof(event)) {
                    emit_error("READ_FAILED", "failed to read evdev event", config->devices[i].path);
                    return 1;
                }
                if (event.type == EV_KEY) {
                    handle_key_event(config, key_counts, event.code, event.value);
                }
            }
        }
    }
    return 0;
}

int main(void) {
    char *json = NULL;
    Config config;
    int result;

    signal(SIGTERM, handle_signal);
    signal(SIGINT, handle_signal);

    if (!read_stdin_line(&json)) {
        emit_error("CONFIG_READ_FAILED", "failed to read helper config from stdin", NULL);
        return 1;
    }
    if (!parse_config(json, &config)) {
        free(json);
        emit_error("CONFIG_INVALID", "helper config is missing required fields or contains unsupported values", NULL);
        return 1;
    }
    free(json);

    if (!open_devices(&config)) {
        return 1;
    }

    result = run(&config);
    close_devices(&config);
    return result;
}
