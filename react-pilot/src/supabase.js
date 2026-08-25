import { createClient } from '@supabase/supabase-js';

/* The same project and the same anon key the rest of the portal uses.
   Note what this file proves rather than what it hides: the key is in the
   built bundle, in plain text, exactly as it is in shared_supabase.js. It
   is meant to be. What an anon key can actually DO is decided by the RLS
   policies in shared/*.sql, not by where the key is written. */
export const SUPA_URL = 'https://kibqjztozokohqmhqqqf.supabase.co';
export const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

export const supabase = createClient(SUPA_URL, SUPA_KEY);
