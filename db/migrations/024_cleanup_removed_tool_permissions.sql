-- Remove per-tool permission rows for tools that no longer exist after removing
-- native Google (Calendar + Gmail) and Todoist integrations.
DELETE FROM tool_permissions
WHERE tool_name IN (
    'calendar_list_events',
    'calendar_create_event',
    'calendar_delete_event',
    'email_send',
    'email_list',
    'email_read',
    'tasks_list',
    'tasks_create',
    'tasks_update',
    'tasks_complete'
);
