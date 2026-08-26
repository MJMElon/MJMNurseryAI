/* ================================================================
   MJM NURSERY AUDIT — LANGUAGE SYSTEM
   lang.js — English / Bahasa Malaysia
================================================================ */

const TRANSLATIONS = {
  en: {
    /* === COMMON === */
    save:           'Save Record',
    cancel:         'Cancel',
    edit:           'Edit Record',
    delete:         'Delete',
    back:           'Back',
    refresh:        'Refresh',
    loading:        'Saving...',
    no_records:     'No records yet',
    all_clear:      'All Clear',
    all_clear_sub:  'No alerts from the latest audit data',
    offline_saved:  '📴 Saved offline — will sync later',
    syncing:        '🔄 Back online — syncing...',
    offline_msg:    '📴 Offline — records will sync when connected',
    delete_confirm: 'Delete Record?',
    delete_msg:     'This audit record will be permanently removed.',
    tap_plus:       'Tap + to add the first audit for',
    select_plot:    '— Select —',
    optional:       'optional',
    required_mark:  '*',

    /* === LOGIN === */
    login_welcome:  'Welcome back',
    login_sub:      'Sign in to the 555 Auditor Portal',
    login_email:    'EMAIL',
    login_password: 'PASSWORD',
    login_btn:      'Login',
    login_failed:   'Incorrect email or password. Please try again.',
    login_offline:  '📴 You are offline. Please connect to login for the first time.',
    login_no_connection: 'Login failed. Please check your connection and try again.',

    /* === HOME === */
    home_greeting_morning:   'Good morning,',
    home_greeting_afternoon: 'Good afternoon,',
    home_greeting_evening:   'Good evening,',
    home_alert_title:        '⚠ Alert Summary',
    home_modules_title:      'Audit Modules',
    home_history_title:      'Audit History',
    home_history_loading:    'Loading history…',
    home_history_empty:      'No audits filed this month.',
    /* === NURSERY CHOOSER + SCHEDULE BOARD === */
    ask_nursery:      'Which nursery are you auditing today?',
    pre_nursery:      'Pre Nursery',
    main_nursery:     'Main Nursery',
    enter:            'Enter',
    switch_note:      'You can switch nursery at any time from the audit menu.',
    main_page:        'Main Page',
    nsw_switch:       'Switch',
    todo_title:       'Audit To-Do',
    tasks_today_one:  'task today',
    tasks_today_many: 'tasks today',
    you_have:         'You have',
    no_audit:         'No audit',
    audit_word:       'audit',
    sched_starts:     'tasks yet — the schedule starts in',
    st_overdue:       'Overdue',
    st_due:           'Due Now',
    st_soon:          'Soon',
    st_upcoming:      'Upcoming',
    anytime:          'Anytime',
    on_demand:        'On Demand',
    all_done:         'All done',
    nursery_1:        'nursery to audit',
    nurseries_n:      'nurseries to audit',
    hi_greeting:      'Hi',
    done_today:       'done today',
    today_congrats:   "Congratulations! You've completed today's tasks!",
    waiting:          'waiting',
    today_btn:        'Today',
    n_overdue:        'overdue',
    n_done_month:     'done this month',
    nothing_on:       'Nothing outstanding on',
    nothing_matches:  'Nothing outstanding matches that filter.',
    all_month_done:   'Every audit for this month is done.',
    none_scheduled:   'No scheduled audits this month.',
    good_morning:     'Good morning,',
    good_afternoon:   'Good afternoon,',
    good_evening:     'Good evening,',

    home_rat:                'Rat Detection',
    home_rat_sub:            'plots affected — Sedikit & Banyak',
    home_pest:               'Pest Infection',
    home_pest_sub:           'plots affected — Banyak only',
    home_yellow:             'Yellow Leaves Detected',
    home_yellow_sub:         'plots with Warna Daun 5',
    home_papan_bad:          'Papan Tanda — Bad / Wrong',
    home_papan_bad_sub:      'plots with issues',
    home_papan_empty:        'Papan Tanda — Empty',
    home_papan_empty_sub:    'plots with empty papan',
    home_plot:               'Plot Condition Audit',
    home_plot_desc:          'Record pest levels, rat activity, leaf disease, and leaf colour per plot across all nursery sites.',
    home_height:             'Seedling Height Audit',
    home_height_desc:        'Measure and record seedling heights with 2 samples per plot.',
    home_papan:              'Papan Tanda Audit',
    home_papan_desc:         'Audit the condition of every papan tanda across all transplant plots.',
    home_maintenance:        'Maintenance Audit',
    home_maintenance_desc:   'Audit completed maintenance tasks from workers. Verify work quality on-site.',
    /* Bucket-tile labels on audit_home. Keep the four in step with
       the BM block below whenever wording changes. */
    bucket_today:            "Today's Audit",
    bucket_sched:            'Scheduled',
    bucket_all:              'All Audit',
    bucket_over:             'Overdue',
    /* Ratio-label words used on the plot-icon subtitle and the
       list-count header on the Plot Condition audit. Kept short so
       "0 / 6 audited" reads at a glance in either language. */
    audited:                 'audited',
    no_batches:              'no batches',
    batch_one:               'batch',
    batches_many:            'batches',
    all_audited:             'all audited',
    pending_word:            'pending',
    no_audit_required_a11y:  'no audit required',
    no_audit_ask:            'No audit needed? Say which kind of plot',
    culling_plot:            'CULLING PLOT',
    transplanting_plot:      'TRANSPLANTING PLOT',
    /* Caption under the 555 wordmark on the shared top ribbon. The
       markup has carried data-t="auditor_portal" since the ribbon
       was written, but the key was never added here — so the bar
       rendered the key itself, as AUDITOR_PORTAL, on every page
       except the back end (whose caption has no data-t). */
    /* The deadline on each to-do row, and how far off it is. */
    due_word:                'due',
    due_today:               'due today',
    days_left:               'days left',
    day_left:                'day left',
    overdue_by:              'overdue',
    days:                    'days',
    day:                     'day',
    auditor_portal:          'Auditor Portal',
    signout:                 'Sign Out',
    signout_msg:             'You will be returned to the login page.',
    stay:                    'Stay',

    /* === PLOT AUDIT === */
    plot_title:          'Plot Condition Audit',
    plot_info:           'Audit Information',
    plot_condition:      'Plot Condition',
    audit_id:            'Audit ID',
    date:                'Date',
    plot:                'Plot',
    batch:               'Batch',
    pest_inf:            'Pest Infestation',
    animal_inf:          'Animal Infestation',
    disease_inf:         'Disease Infestation',
    leaf_cond:           'Leaf Condition',
    banyak:              'Banyak',
    sedikit:             'Sedikit',
    tidak_ada:           'Tidak Ada',
    very_green:          'Very Green',
    green:               'Green',
    light_green:         'Light Green',
    yellowish:           'Yellowish',
    very_yellow:         'Very Yellow',
    photo_plot:          'Plot Photos',
    photo_req:           '2 photos required',
    photo_both_req:      '⚠ Both photos are required',
    new_audit:           'New Audit',

    /* === HEIGHT AUDIT === */
    height_title:        'Seedling Height Audit',
    height_samples:      'Seedling Height Samples',
    height_photos:       'Gambar Sampel (Photos)',
    height_avg:          'Average Height',
    sample:              'Sample',
    this_month:          'This Month',
    plots_150:           'Plots ≥150cm',
    reached_pct:         'Reached %',
    photo_2_req:         '2 photos required — one per sample',
    photo_3_req:         '3 photos required — one per sample',
    err_3_photos:        '⚠ Please upload all 3 photos',

    /* === PAPAN AUDIT === */
    papan_title:         'Papan Tanda Audit',
    papan_checks:        'Papan Tanda Checks',
    presence_cond:       'Presence & Condition',
    correct_info:        'Correct Information',
    height_150:          'Height of Papan Tanda (150cm)',
    good:                'Good ✓',
    bad:                 'Bad ✗',
    empty:               'Empty',
    correct:             'Correct ✓',
    wrong:               'Wrong ✗',
    batch_info:          'Batch Info',
    plots_to_audit:      'Plots to Audit',
    completion:          '✅ Completion',
    audit_now:           'Audit Now',
    re_audit:            'Re-audit',
    view:                'View',
    pending:             'Pending',
    pass:                'Pass ✓',
    fail:                'Fail ✗',
    issues:              'Issues',
    nursery:             'Nursery',
    breed:               'Breed',
    qty:                 'Qty',
    planted:             'Planted',
    transplant:          'Transplant',
    mature:              'Mature',
    latest:              'Latest',
    remarks:             'Remarks',
    remarks_ph:          'Any additional notes...',
    photo_optional:      'Photo optional',

    /* === MAINTENANCE AUDIT === */
    maint_title:         'Maintenance Audit',
    maint_result:        'Audit Result',
    work_quality:        'Work Quality',
    satisfactory:        '✓ Satisfactory',
    unsatisfactory:      '✗ Unsatisfactory',
    not_done:            '— Not Done',
    to_audit:            'To Audit',
    history:             'History',
    task_type:           'Task Type',
    chemical:            'Chemical',
    round:               'Round',
    worker:              'Worker',
    completed:           'Completed',
    audit_photo:         'Audit Photo',
    /* Dead entry removed — `all_audited` above is the live one, used as
       the short "all audited" plot-icon subtitle. The papan empty-state
       still hard-codes the emoji string, so nothing referenced this. */


    /* === EXTRA === */
    records:        'records',
    record:         'record',
    photo1:         'Photo 1',
    photo2:         'Photo 2',
    photo_label:    'Photo',
    camera:         '📷 Camera',
    gallery:        '🖼 Gallery',
    pest:           'Pest',
    animal:         'Animal',
    disease:        'Disease',
    new_audit:      'New Audit',
    new_record:     'New Record',
    plot_condition: 'Plot Condition',
    select_plot:    '— Select —',
    no_audits:      'No audits yet',
    tap_add:        'Tap + to add the first audit for',
    alerts_title:   '⚠ Alerts',
    plot_affected_s:'plot affected',
    plot_affected_p:'plots affected',
    module1:        'Module 1',
    module2:        'Module 2',
    module3:        'Module 3',
    module4:        'Module 4',
    total:          'Total',
    this_month:     'This Month',
    avg_cm:         'Avg cm',
    max_cm:         'Max cm',
    height_record:  'New Record',
    record_info:    'Record Information',
    record_id:      'Record ID',
    sample1:        'Sample 1',
    sample2:        'Sample 2',
    sample3:        'Sample 3',
    avg_height:     'Average Height',
    add_photo:      'Add Photo',
    photo_sample:   'Sample',
    no_remarks:     'No remarks.',
    auditor:        'Auditor',
    worker_photos:  'worker photo',
    worker_photos_p:'worker photos',
    audit_result:   'Audit Result',
    delete_batch:   'Delete Batch?',
    delete_batch_msg: 'This batch and its linked audit will be permanently removed.',
    no_plots:       'No plots to audit',
    no_plots_sub:   'Add batch records in the Batch Info tab first.',
    add_batch:      'New Batch',
    edit_batch:     'Edit Batch',
    save_batch:     'Save Batch',
    save_all_filled:'Save All Filled Batches',
    save_plot_audit:'Save Plot Audit',
    batches_on_plot:'Batches on this plot',
    select_nursery: 'Select Nursery',
    date_planted:   'Date Planted',
    date_transplant:'Date Transplant',
    date_mature:    'Date Mature',
    auto_3mo:       'auto: planted +3 months',
    auto_9mo:       'auto: planted +9 months',
    plot_amount:    'Plot Amount (Qty)',
    batch_no:       'Batch No.',
    breed_variety:  'Breed / Variety',
    key_dates:      'Key Dates',
    batch_info_sec: 'Batch Information',
    view_audit:     'View Audit',
    re_audit_btn:   'Re-audit',
    audit_now_btn:  'Audit Now',
    all_audited_msg:'🎉 All plots audited!',
    no_audited:     'No audited tasks yet.',
    task_info:      'Task Info',
    no_tasks:       'No tasks to audit',
    no_tasks_sub:   'Completed work orders from workers will appear here automatically.',
    satisfactory_r: 'Satisfactory',
    unsatisfactory_r:'Unsatisfactory',
    not_done_r:     'Not Done',
    pending_s:      'Pending',
    pass_s:         'Pass ✓',
    fail_s:         'Fail ✗',
    issues_s:       'Issues',
    photo_required: '⚠ Please upload an audit photo',


    // The duplicate === EXTRA === block that lived here was full of
    // Malay values (Belum Selesai / Lulus / Gagal / …) inside the
    // ENGLISH object. Because JS keeps the LAST duplicated key, every
    // one of those Malay values was silently overriding the correct
    // English label a few dozen lines above — that's why Papan Tanda's
    // status pills came out as "Belum Selesai" when the user had picked
    // EN. Every key it defined already exists earlier in this same EN
    // object with the correct English value, so the whole duplicate
    // block is safe to remove.


    err_select_plot: '⚠ Please select a plot',
    err_batch:       '⚠ Please enter batch number',
    err_pest:        '⚠ Please select Pest Infestation level',
    err_animal:      '⚠ Please select Animal Infestation level',
    err_disease:     '⚠ Please select Disease Infestation level',
    err_leaf:        '⚠ Please select Leaf Condition',
    err_load:        '⚠ Failed to load',
    err_save:        '⚠ Save failed',
    err_delete:      '⚠ Delete failed',
    err_delete_admin_only: '⚠ Only an admin can delete records',
    record_deleted:  'Record deleted',
    record_updated:  '✓ Record updated',
    record_saved:    '✓ Record saved',
    ranking:         'Ranking',
    of5:             'of 5',


    cam:              'Camera',
    gal:              'Gallery',
    edit_lbl:         'Edit',
    record_detail:    'Record Detail',
    err_height:       '⚠ Please enter at least one height',
    err_all_samples:  '⚠ Please enter both height samples',
    err_photos:       '⚠ Please upload both photos',
    nursery_lbl:      'Nursery:',
    plot_lbl:         'Plot:',
    batch_lbl:        'Batch:',
    breed_lbl:        'Breed:',
    qty_lbl:          'Qty:',
    quantity_lbl:     'Quantity:',
    transplant_lbl:   'Transplant:',
    transplanted_lbl: 'Transplanted Date:',
    mature_lbl:       'Mature:',
    planted_lbl:      'Planted Date:',
    audit_tab:        'Audit',
    photo_papan:      'Gambar Papan Tanda',
    optional_lbl:     'OPTIONAL',


    err_photo_required: '⚠ Please upload a photo',
    err_kehadiran:    '⚠ Please select Presence & Condition',
    err_maklumat:     '⚠ Please select Correct Information',
    err_keadaan:      '⚠ Please select Height of Papan Tanda',
    audit_deleted:    'Audit deleted',
    audit_updated:    '✓ Audit updated',
    audit_saved:      '✓ Audit saved',
    batch_updated:    '✓ Batch updated',
    batch_saved:      '✓ Batch saved',
    batch_deleted:    'Batch deleted',
    err_breed:        '⚠ Please select a breed',
    err_qty:          '⚠ Please enter plot amount',
    err_date_planted: '⚠ Please enter date planted',
    err_date_transplant:'⚠ Date transplant is required',


    back_portal:       'Back to Portal',
    forgot_password:    'Forgot Password?',
    sign_up:            'Sign Up',
    forgot_title:       'Reset Password',
    forgot_sub:         'Enter your email and we will send you a reset link.',
    send_reset:         'Send Reset Link',
    sending:            'Sending...',
    reset_sent:         '✓ Reset link sent! Check your email.',
    reset_failed:       'Failed to send reset email. Please try again.',
    signup_title:       'Create Account',
    signup_sub:         'Register to access the 555 Auditor Portal.',
    sign_up_btn:        'Create Account',
    creating:           'Creating...',
    signup_success:     '✓ Account created! Please check your email to verify, then log in.',
    signup_failed:      'Sign up failed. Please try again.',
    email_label:        'EMAIL',
    password_label:     'PASSWORD',
    full_name_label:    'FULL NAME',
    err_name_required:  '⚠ Please enter your full name',
    err_email_required: '⚠ Please enter your email',
    err_password_required: '⚠ Please enter a password',
    err_password_short: '⚠ Password must be at least 6 characters',

    /* === ALERTS === */
    alert_rat:           'Animal Infestation',
    alert_pest:          'Pest Infestation',
    alert_yellow:        'Yellow Leaves',
    plot_affected:       'plot affected',
    plots_affected:      'plots affected',
  },

  ms: {
    /* === COMMON === */
    save:           'Simpan Rekod',
    cancel:         'Batal',
    edit:           'Edit Rekod',
    delete:         'Padam',
    back:           'Kembali',
    refresh:        'Muat Semula',
    loading:        'Menyimpan...',
    no_records:     'Tiada rekod lagi',
    all_clear:      'Tiada Amaran',
    all_clear_sub:  'Tiada amaran daripada data audit terkini',
    offline_saved:  '📴 Disimpan luar talian — akan disegerakkan kemudian',
    syncing:        '🔄 Dalam talian semula — menyegerakkan...',
    offline_msg:    '📴 Luar talian — rekod akan disegerakkan apabila ada sambungan',
    delete_confirm: 'Padam Rekod?',
    delete_msg:     'Rekod audit ini akan dipadamkan secara kekal.',
    tap_plus:       'Ketik + untuk tambah audit pertama bagi',
    select_plot:    '— Pilih Plot —',
    optional:       'pilihan',
    required_mark:  '*',

    /* === LOGIN === */
    login_welcome:  'Selamat Kembali',
    login_sub:      'Log masuk ke Portal Juruaudit 555',
    login_email:    'E-MEL',
    login_password: 'KATA LALUAN',
    login_btn:      'Log Masuk',
    login_failed:   'E-mel atau kata laluan salah. Sila cuba lagi.',
    login_offline:  '📴 Anda luar talian. Sila sambung internet untuk log masuk buat pertama kali.',
    login_no_connection: 'Log masuk gagal. Sila semak sambungan anda.',

    /* === HOME === */
    home_greeting_morning:   'Selamat pagi,',
    home_greeting_afternoon: 'Selamat tengah hari,',
    home_greeting_evening:   'Selamat petang,',
    home_alert_title:        '⚠ Ringkasan Amaran',
    home_modules_title:      'Modul Audit',
    home_history_title:      'Sejarah Audit',
    home_history_loading:    'Memuatkan sejarah…',
    home_history_empty:      'Tiada audit direkodkan bulan ini.',
    /* === PEMILIHAN NURSERI + PAPAN JADUAL === */
    ask_nursery:      'Nurseri mana anda audit hari ini?',
    pre_nursery:      'Tapak Semaian Kecil',
    main_nursery:     'Tapak Semaian Besar',
    enter:            'Masuk',
    switch_note:      'Anda boleh tukar nurseri bila-bila masa dari menu audit.',
    main_page:        'Halaman Utama',
    nsw_switch:       'Tukar',
    todo_title:       'Senarai Tugas Audit',
    tasks_today_one:  'tugas hari ini',
    tasks_today_many: 'tugas hari ini',
    you_have:         'Anda ada',
    no_audit:         'Tiada audit',
    audit_word:       'audit',
    sched_starts:     'tugas lagi — jadual bermula pada',
    st_overdue:       'Tertunggak',
    st_due:           'Perlu Buat',
    st_soon:          'Tidak Lama Lagi',
    st_upcoming:      'Akan Datang',
    anytime:          'Bila-bila Masa',
    on_demand:        'Ikut Keperluan',
    all_done:         'Semua selesai',
    nursery_1:        'nurseri belum diaudit',
    nurseries_n:      'nurseri belum diaudit',
    hi_greeting:      'Hai',
    done_today:       'siap hari ini',
    today_congrats:   'Tahniah! Anda telah menyelesaikan tugasan hari ini!',
    waiting:          'menunggu',
    today_btn:        'Hari Ini',
    n_overdue:        'tertunggak',
    n_done_month:     'selesai bulan ini',
    nothing_on:       'Tiada tugas tertunggak pada',
    nothing_matches:  'Tiada tugas tertunggak yang sepadan dengan penapis itu.',
    all_month_done:   'Semua audit bulan ini telah selesai.',
    none_scheduled:   'Tiada audit dijadualkan bulan ini.',
    good_morning:     'Selamat pagi,',
    good_afternoon:   'Selamat tengah hari,',
    good_evening:     'Selamat petang,',

    home_rat:                'Pengesanan Tikus',
    home_rat_sub:            'plot terjejas — Sedikit & Banyak',
    home_pest:               'Jangkitan Perosak',
    home_pest_sub:           'plot terjejas — Banyak sahaja',
    home_yellow:             'Daun Kuning Dikesan',
    home_yellow_sub:         'plot dengan Warna Daun 5',
    home_papan_bad:          'Papan Tanda — Buruk / Salah',
    home_papan_bad_sub:      'plot bermasalah',
    home_papan_empty:        'Papan Tanda — Kosong',
    home_papan_empty_sub:    'plot dengan papan kosong',
    home_plot:               'Audit Keadaan Plot',
    home_plot_desc:          'Rekod tahap perosak, aktiviti tikus, penyakit daun, dan warna daun bagi setiap plot.',
    home_height:             'Audit Ketinggian Anak Benih',
    home_height_desc:        'Ukur dan rekod ketinggian anak benih dengan 2 sampel setiap plot.',
    home_papan:              'Audit Papan Tanda',
    home_papan_desc:         'Audit keadaan setiap papan tanda di semua plot yang telah dipindah.',
    home_maintenance:        'Audit Penyelenggaraan',
    home_maintenance_desc:   'Audit tugas penyelenggaraan yang telah siap oleh pekerja. Sahkan kualiti kerja di tapak.',
    /* Bucket-tile labels (Malay). Match the four in the EN block above. */
    bucket_today:            'Audit Hari Ini',
    bucket_sched:            'Dijadualkan',
    bucket_all:              'Semua Audit',
    bucket_over:             'Audit Tertunggak',
    /* Ratio-label words (Malay) for the plot-icon subtitle and the
       list-count header on the Plot Condition audit. */
    audited:                 'Diaudit',
    no_batches:              'tiada lot',
    batch_one:               'lot',
    batches_many:            'lot',
    all_audited:             'semua diaudit',
    pending_word:            'belum audit',
    no_audit_required_a11y:  'audit tidak diperlukan',
    no_audit_ask:            'Tiada audit perlu? Nyatakan jenis plot',
    culling_plot:            'PLOT CULLING',
    transplanting_plot:      'PLOT PINDAH',
    due_word:                'tarikh akhir',
    due_today:               'tarikh akhir hari ini',
    days_left:               'hari lagi',
    day_left:                'hari lagi',
    overdue_by:              'lewat',
    days:                    'hari',
    day:                     'hari',
    auditor_portal:          'Portal Juruaudit',
    signout:                 'Log Keluar',
    signout_msg:             'Anda akan dikembalikan ke halaman log masuk.',
    stay:                    'Kekal',

    /* === PLOT AUDIT === */
    plot_title:          'Audit Keadaan Plot',
    plot_info:           'Maklumat Audit',
    plot_condition:      'Keadaan Plot',
    audit_id:            'ID Audit',
    date:                'Tarikh',
    plot:                'Plot',
    batch:               'Batch',
    pest_inf:            'Serangan Perosak',
    animal_inf:          'Serangan Haiwan',
    disease_inf:         'Serangan Penyakit',
    leaf_cond:           'Keadaan Daun',
    banyak:              'Banyak',
    sedikit:             'Sedikit',
    tidak_ada:           'Tidak Ada',
    very_green:          'Sangat Hijau',
    green:               'Hijau',
    light_green:         'Hijau Muda',
    yellowish:           'Kekuningan',
    very_yellow:         'Sangat Kuning',
    photo_plot:          'Gambar Plot',
    photo_req:           '2 gambar diperlukan',
    photo_both_req:      '⚠ Kedua-dua gambar diperlukan',
    new_audit:           'Audit Baru',

    /* === HEIGHT AUDIT === */
    height_title:        'Audit Ketinggian Anak Benih',
    height_samples:      'Sampel Ketinggian Anak Benih',
    height_photos:       'Gambar Sampel',
    height_avg:          'Purata Ketinggian',
    sample:              'Sampel',
    this_month:          'Bulan Ini',
    plots_150:           'Plot ≥150sm',
    reached_pct:         'Peratus Capai',
    photo_2_req:         '2 gambar diperlukan — satu setiap sampel',
    photo_3_req:         '3 gambar diperlukan — satu setiap sampel',
    err_3_photos:        '⚠ Sila muat naik ketiga-tiga gambar',

    /* === PAPAN AUDIT === */
    papan_title:         'Audit Papan Tanda',
    papan_checks:        'Semakan Papan Tanda',
    presence_cond:       'Kehadiran & Keadaan',
    correct_info:        'Maklumat Betul',
    height_150:          'Ketinggian Papan Tanda (150sm)',
    good:                'Baik ✓',
    bad:                 'Buruk ✗',
    empty:               'Kosong',
    correct:             'Betul ✓',
    wrong:               'Salah ✗',
    batch_info:          'Maklumat Batch',
    plots_to_audit:      'Plot Untuk Diaudit',
    completion:          '✅ Selesai',
    audit_now:           'Audit Sekarang',
    re_audit:            'Audit Semula',
    view:                'Lihat',
    pending:             'Belum Selesai',
    pass:                'Lulus ✓',
    fail:                'Gagal ✗',
    issues:              'Isu',
    nursery:             'Nurseri',
    breed:               'Baka',
    qty:                 'Kuantiti',
    planted:             'Tarikh Tanam',
    transplant:          'Tarikh Pindah',
    mature:              'Tarikh Matang',
    latest:              'Terkini',
    remarks:             'Catatan',
    remarks_ph:          'Sebarang nota tambahan...',
    photo_optional:      'Gambar pilihan',

    /* === MAINTENANCE AUDIT === */
    maint_title:         'Audit Penyelenggaraan',
    maint_result:        'Keputusan Audit',
    work_quality:        'Kualiti Kerja',
    satisfactory:        '✓ Memuaskan',
    unsatisfactory:      '✗ Tidak Memuaskan',
    not_done:            '— Tidak Dibuat',
    to_audit:            'Untuk Diaudit',
    history:             'Sejarah',
    task_type:           'Jenis Kerja',
    chemical:            'Bahan Kimia',
    round:               'Pusingan',
    worker:              'Pekerja',
    completed:           'Tarikh Siap',
    audit_photo:         'Gambar Audit',
    /* Dead entry removed — `all_audited` above is the live one. */


    /* === EXTRA ===
       This block was previously copy-pasted from the EN block without
       being translated. JS keeps the later key, so every entry below
       silently overrode the Malay ones defined earlier in this same
       object — that's why Seedling Height Samples / Average Height /
       Sample 1-3 still rendered in English on the height form. Now
       translated in place; any key that also exists earlier still ends
       up Malay either way. */
    records:        'rekod',
    record:         'rekod',
    photo1:         'Gambar 1',
    photo2:         'Gambar 2',
    photo_label:    'Gambar',
    camera:         '📷 Kamera',
    gallery:        '🖼 Galeri',
    pest:           'Perosak',
    animal:         'Haiwan',
    disease:        'Penyakit',
    new_audit:      'Audit Baru',
    new_record:     'Rekod Baru',
    plot_condition: 'Keadaan Plot',
    select_plot:    '— Pilih —',
    no_audits:      'Tiada audit lagi',
    tap_add:        'Tekan + untuk menambah audit pertama untuk',
    alerts_title:   '⚠ Amaran',
    plot_affected_s:'plot terjejas',
    plot_affected_p:'plot terjejas',
    module1:        'Modul 1',
    module2:        'Modul 2',
    module3:        'Modul 3',
    module4:        'Modul 4',
    total:          'Jumlah',
    this_month:     'Bulan Ini',
    avg_cm:         'Purata sm',
    max_cm:         'Maks sm',
    height_record:  'Rekod Baru',
    record_info:    'Maklumat Rekod',
    record_id:      'ID Rekod',
    sample1:        'Sampel 1',
    sample2:        'Sampel 2',
    sample3:        'Sampel 3',
    avg_height:     'Purata Ketinggian',
    add_photo:      'Tambah Gambar',
    photo_sample:   'Sampel',
    no_remarks:     'Tiada catatan.',
    auditor:        'Juruaudit',
    worker_photos:  'gambar pekerja',
    worker_photos_p:'gambar pekerja',
    audit_result:   'Keputusan Audit',
    delete_batch:   'Padam Batch?',
    delete_batch_msg: 'Batch ini dan audit berkaitan akan dipadamkan secara kekal.',
    no_plots:       'Tiada plot untuk audit',
    no_plots_sub:   'Tambah rekod batch dalam tab Batch Info terlebih dahulu.',
    add_batch:      'Batch Baru',
    edit_batch:     'Edit Batch',
    save_batch:     'Simpan Batch',
    save_all_filled:'Simpan Semua Batch Yang Diisi',
    save_plot_audit:'Simpan Audit Plot',
    batches_on_plot:'Batch di plot ini',
    select_nursery: 'Pilih Tapak Semaian',
    date_planted:   'Tarikh Ditanam',
    date_transplant:'Tarikh Pindah',
    date_mature:    'Tarikh Matang',
    auto_3mo:       'auto: ditanam +3 bulan',
    auto_9mo:       'auto: ditanam +9 bulan',
    plot_amount:    'Jumlah Plot (Kuantiti)',
    batch_no:       'No. Batch',
    breed_variety:  'Baka / Varieti',
    key_dates:      'Tarikh Penting',
    batch_info_sec: 'Maklumat Batch',
    view_audit:     'Lihat Audit',
    re_audit_btn:   'Audit Semula',
    audit_now_btn:  'Audit Sekarang',
    all_audited_msg:'🎉 Semua plot telah diaudit!',
    no_audited:     'Tiada tugas yang telah diaudit lagi.',
    task_info:      'Maklumat Tugas',
    no_tasks:       'Tiada tugas untuk audit',
    no_tasks_sub:   'Kerja siap dari pekerja akan muncul di sini secara automatik.',
    satisfactory_r: 'Memuaskan',
    unsatisfactory_r:'Tidak Memuaskan',
    not_done_r:     'Tidak Dilakukan',
    pending_s:      'Menunggu',
    pass_s:         'Lulus ✓',
    fail_s:         'Gagal ✗',
    issues_s:       'Isu',
    photo_required: '⚠ Sila muat naik gambar audit',


    err_select_plot: '⚠ Sila pilih plot',
    err_batch:       '⚠ Sila masukkan nombor batch',
    err_pest:        '⚠ Sila pilih tahap Serangan Perosak',
    err_animal:      '⚠ Sila pilih tahap Serangan Haiwan',
    err_disease:     '⚠ Sila pilih tahap Serangan Penyakit',
    err_leaf:        '⚠ Sila pilih Keadaan Daun',
    err_load:        '⚠ Gagal memuatkan data',
    err_save:        '⚠ Gagal menyimpan',
    err_delete:      '⚠ Gagal memadam',
    err_delete_admin_only: '⚠ Hanya admin boleh memadam rekod',
    record_deleted:  'Rekod dipadamkan',
    record_updated:  '✓ Rekod dikemas kini',
    record_saved:    '✓ Rekod disimpan',
    ranking:         'Kedudukan',
    of5:             'daripada 5',


    cam:              'Kamera',
    gal:              'Galeri',
    edit_lbl:         'Edit',
    record_detail:    'Butiran Rekod',
    err_height:       '⚠ Sila masukkan sekurang-kurangnya satu ketinggian',
    err_all_samples:  '⚠ Sila masukkan kedua-dua sampel ketinggian',
    err_photos:       '⚠ Sila muat naik kedua-dua gambar',
    nursery_lbl:      'Nurseri:',
    plot_lbl:         'Plot:',
    batch_lbl:        'Batch:',
    breed_lbl:        'Baka:',
    qty_lbl:          'Kuantiti:',
    quantity_lbl:     'Kuantiti:',
    transplant_lbl:   'Tarikh Pindah:',
    transplanted_lbl: 'Tarikh Pindah:',
    mature_lbl:       'Tarikh Matang:',
    planted_lbl:      'Tarikh Tanam:',
    audit_tab:        'Audit',
    photo_papan:      'Gambar Papan Tanda',
    optional_lbl:     'PILIHAN',


    err_photo_required: '⚠ Please upload a photo',
    err_photo_required: '⚠ Sila muat naik gambar',
    err_kehadiran:    '⚠ Sila pilih Kehadiran & Keadaan',
    err_maklumat:     '⚠ Sila pilih Maklumat Betul',
    err_keadaan:      '⚠ Sila pilih Ketinggian Papan Tanda',
    audit_deleted:    'Audit dipadamkan',
    audit_updated:    '✓ Audit dikemas kini',
    audit_saved:      '✓ Audit disimpan',
    batch_updated:    '✓ Batch dikemas kini',
    batch_saved:      '✓ Batch disimpan',
    batch_deleted:    'Batch dipadamkan',
    err_breed:        '⚠ Sila pilih baka',
    err_qty:          '⚠ Sila masukkan jumlah plot',
    err_date_planted: '⚠ Sila masukkan tarikh tanam',
    err_date_transplant:'⚠ Tarikh pindah diperlukan',


    back_portal:       'Back to Portal',
    back_portal:       'Kembali ke Portal',
    forgot_password:    'Lupa Kata Laluan?',
    sign_up:            'Daftar',
    forgot_title:       'Set Semula Kata Laluan',
    forgot_sub:         'Masukkan e-mel anda dan kami akan hantar pautan untuk set semula.',
    send_reset:         'Hantar Pautan Reset',
    sending:            'Menghantar...',
    reset_sent:         '✓ Pautan dihantar! Semak e-mel anda.',
    reset_failed:       'Gagal menghantar e-mel reset. Sila cuba lagi.',
    signup_title:       'Buat Akaun',
    signup_sub:         'Daftar untuk akses Portal Juruaudit 555.',
    sign_up_btn:        'Buat Akaun',
    creating:           'Mencipta...',
    signup_success:     '✓ Akaun dibuat! Sila semak e-mel anda untuk pengesahan, kemudian log masuk.',
    signup_failed:      'Pendaftaran gagal. Sila cuba lagi.',
    email_label:        'E-MEL',
    password_label:     'KATA LALUAN',
    full_name_label:    'NAMA PENUH',
    err_name_required:  '⚠ Sila masukkan nama penuh anda',
    err_email_required: '⚠ Sila masukkan e-mel anda',
    err_password_required: '⚠ Sila masukkan kata laluan',
    err_password_short: '⚠ Kata laluan mesti sekurang-kurangnya 6 aksara',

    /* === ALERTS === */
    alert_rat:           'Serangan Haiwan',
    alert_pest:          'Serangan Perosak',
    alert_yellow:        'Daun Kuning',
    plot_affected:       'plot terjejas',
    plots_affected:      'plot terjejas',
  }
};

/* ================================================================
   LANGUAGE ENGINE
================================================================ */
let currentLang = localStorage.getItem('mjm_lang') || 'en';

function t(key){
  return TRANSLATIONS[currentLang][key] || TRANSLATIONS['en'][key] || key;
}

/* Standard thousands grouping (1,234,567). Applied to any user-visible
   number in the audit surface — qty, stat totals, counts. Preserves any
   non-numeric passthrough (null, '', '—', 'Pending') unchanged so callers
   can pipe values through it without pre-checking. Decimals are kept
   as-is, formatted with the en-MY locale (which matches the rest of the
   audit UI's date formatting).

   Callers: papan stat cards + card qty + detail grid, height stat
   cards (when re-added), maintenance stat cards. Kept as a global so
   every audit page picks it up via the audit_lang.js include order. */
function fmtNum(n){
  if (n == null || n === '' || n === '—') return n;
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);      // "Pending", "N/A", etc.
  return num.toLocaleString('en-MY');
}
window.fmtNum = fmtNum;

function setLang(lang){
  currentLang = lang;
  localStorage.setItem('mjm_lang', lang);
  applyTranslations();
  updateLangBtn();
  /* applyTranslations only rewrites elements that are already in the page
     carrying a data-t. Anything a script builds — the schedule board, the
     status chips — has to redraw itself, so tell it the language moved. */
  document.dispatchEvent(new CustomEvent('mjm-lang-changed', {detail:{lang:lang}}));
}

function toggleLang(){
  setLang(currentLang === 'en' ? 'ms' : 'en');
}

/* Apply translations to all elements with data-t attribute */
function applyTranslations(){
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.dataset.t;
    const val = t(key);
    if(el.tagName === 'INPUT' && el.placeholder !== undefined){
      el.placeholder = val;
    } else {
      el.textContent = val;
    }
  });
  // Update html lang attribute
  document.documentElement.lang = currentLang === 'ms' ? 'ms' : 'en';
}

function updateLangBtn(){
  const btns = document.querySelectorAll('.lang-toggle-btn');
  btns.forEach(btn => {
    btn.textContent = currentLang === 'en' ? 'BM' : 'EN';
    btn.title = currentLang === 'en' ? 'Tukar ke Bahasa Malaysia' : 'Switch to English';
  });
}

/* Run on DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  applyTranslations();
  updateLangBtn();
});