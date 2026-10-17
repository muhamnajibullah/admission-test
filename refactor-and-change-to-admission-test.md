# Gunakan bahasa inggris untuk project ini labeling semuanya.
# Refactor tapi tetap mempertahankan fungsi.
# Tetap gunakan HTML, CSS, Javascript, PHP native saja seperti saat ini jangan menambahkan stack yang tidak diminta
# Rapihkan penamaan dan struktur foldering kecuali yang menjadi halaman utama.
# Halaman utama yang akan dibuka ketika mengakses folder ini nanti akan tetap submit_application tapi diubah saja namanya menjadi exam, sesuaikan yang terkait.

1. Saya ingin membuat project ini menjadi ujian untuk calon siswa.
2. Semua yang berhubungan dengan guru diganti menjadi calon siswa.
3. Database juga disesuaikan dengan membuat database baru bukan yang saat ini ada, lalu dibuat lebih dinamis agar berjalan di local dan juga di path untuk cpanel tersebut, nama db untuk cpanel adalah alazkasch_admission_test dan untuk local juga samakan saja.
4. User dan password admin pindahkan di database dan pastikan password dihash, lalu username buat menjadi admin@admission.test dan passwordnya Alazka2026 saja dibuat menjadi 1 saja akses adminnya.
5. Mengubah position dan course menjadi Unit saja, nanti question bank akan terhubung ke Unit tersebut, dan question bank yang aktif hanya bisa 1, yang lainnya akan tidak aktif saat dibuat ketika sudah ada question bank yang aktif, tapi bisa diganti question bank yang digunakan ya.
6. Ketika membuat Unit ada pilihan tambahan city, Jakarta atau Surabaya
7. Field pendaftaran menjadi Nama, Tanggal Lahir, dan Unit, untuk question bank karena hanya cuma 1 yang bisa aktif jadi langsung terkoneksi dengan question bank yang aktif untuk unit tersebut.
8. Untuk exam token durasinya bisa ditentukan oleh admin ketika klik generate token, bisa memilih berdasarkan menit atau detik dan menyesuaikan.
9. tambahkan filter unit di bagian test result untuk filter hasil test berdasarkan unit.
10. gunakan latex untuk inputan rumus matematika ketika di rich text editor tersebut.
11. Pastikan ketika membuat soal tidak ada behaviour yang menyebabkan tag html atau sejenisnya terinput tidak sengaja yang menyebabkan soal rusak.
12. Tambahkan durasi untuk exam di question bank, untuk menentukan durasi testnya secara independen, jadi durasi test tidak hardcode lagi.
13. redesign seperti image.png yang ada di root folder untuk halaman test tapi menyesuaikan tema project ini, bisa diflag untuk jawaban yang tidak yakin dan ada indikator sudah diisi atau belumnya, lalu gunakan bahasa inggris ya.
14. untuk mekanisme penyimpanan gambar juga diubah menjadi disimpan di folder pada project bukan langsung ke database tapi memanggil file path name.
15. Gunakan clean code method dan pastikan beri komentar pada kode yang akan dibuat.
16. Gunakan metode API REST agar lebih baik lagi, dan PHP version pada cpanel itu 7.4 pastikan kompatibel.

# Sisanya tampilan dibuat sama dulu nanti akan saya revisi lagi, ini hanya dijalankan satu kali ya tidak berkali-kali ketika kamu diperintahkan mengubah project.
# Jangan buat kesalahan yang fatal, tapi kerjakan semuanya dengan teliti.