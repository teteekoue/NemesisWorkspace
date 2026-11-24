import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * La signature de publication.
 *
 * La clé vit dans les secrets du dépôt ; la construction de CI la dépose dans
 * un fichier de propriétés. Sans ce fichier (une compilation locale), la
 * variante de publication n'est pas signée : elle sert à vérifier que le code
 * compile, jamais à publier.
 */
val keystoreFile = rootProject.file("keystore/nemesis-release.p12")
val keystorePassword = rootProject.file("keystore/nemesis-release.pass")
    .takeIf { it.exists() }?.readText()?.trim().orEmpty()

val keystoreProperties = Properties().apply {
    val overrides = rootProject.file("keystore.properties")
    // Une clé fournie par la forge (secret) prend le pas sur celle du code.
    if (overrides.exists()) overrides.inputStream().use { load(it) }
}
val hasReleaseKey =
    keystoreProperties.getProperty("storeFile") != null ||
        (keystoreFile.exists() && keystorePassword.isNotEmpty())

android {
    namespace = "com.nemesisworkspace.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.nemesisworkspace.app"
        // 26 : les icônes adaptatives et le stockage par fichier existent
        // partout, y compris sur les Chromebooks et les appareils d'entrée de
        // gamme encore en service.
        minSdk = 26
        targetSdk = 35
        versionCode = (project.findProperty("nemesis.versionCode") as String? ?: "1").toInt()
        versionName = (project.findProperty("nemesis.versionName") as String? ?: "1.0.0")
    }

    /*
     * Aucun code natif : l'interface est du JavaScript compilé, et Android
     * exécute le reste avec sa propre machine virtuelle. Un paquet par
     * architecture pèse donc presque autant que l'universel, mais il est
     * demandé explicitement : il est publié pour chaque famille (x86 en
     * premier, pour les Chromebooks et les tablettes Intel), avec en plus le
     * paquet universel qui s'installe partout.
     */
    splits {
        abi {
            isEnable = true
            reset()
            // Trois familles demandées, et les deux d'Intel : les Chromebooks
            // et les tablettes x86 sont la priorité.
            include("x86", "armeabi-v7a", "arm64-v8a")
            isUniversalApk = true
        }
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(
                    keystoreProperties.getProperty("storeFile") ?: "keystore/nemesis-release.p12",
                )
                storePassword = keystoreProperties.getProperty("storePassword") ?: keystorePassword
                keyAlias = keystoreProperties.getProperty("keyAlias") ?: "nemesisworkspace"
                keyPassword = keystoreProperties.getProperty("keyPassword") ?: keystorePassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            if (hasReleaseKey) signingConfig = signingConfigs.getByName("release")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    // Les fichiers de l'interface restent compressés : le paquet est plus
    // petit, et rien de ce qu'ils contiennent n'est lu directement par le
    // système — c'est l'application qui les sert, déjà décompressés.
    androidResources {
        noCompress += listOf("woff", "woff2")
    }

    packaging {
        jniLibs {
            // Les trois architectures coexistent dans la version universelle.
            useLegacyPackaging = false
        }
        resources {
            excludes += listOf(
                "META-INF/*.version",
                "META-INF/*.kotlin_module",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE*",
                "META-INF/NOTICE*",
            )
        }
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        // Une erreur de lint n'empêche pas de produire les paquets : elle est
        // publiée dans le rapport de la construction, et le paquet est
        // vérifié avant d'être publié.
        abortOnError = false
        checkReleaseBuilds = false
        warningsAsErrors = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    // Le nom des paquets produits, pour que les versions publiées se
    // reconnaissent d'un coup d'œil : architecture puis numéro de version.
    applicationVariants.all {
        outputs.all {
            val output = this as com.android.build.gradle.internal.api.BaseVariantOutputImpl
            val abi = output.getFilter("ABI")
            val suffix = if (abi.isNullOrBlank()) "universal" else abi
            output.outputFileName = "NemesisWorkspace-${versionName}-$suffix.apk"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
