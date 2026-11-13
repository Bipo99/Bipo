plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "com.bipo99.bipo"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "com.bipo99.bipo"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        // Android 10 (API 29) è la versione minima supportata.
        minSdk = 29
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Chiave di firma di SVILUPPO, versionata apposta: così ogni build del cloud
    // è firmata con la stessa chiave e l'APK si aggiorna senza disinstallare.
    // Nella Fase 8 passeremo a una chiave privata custodita nei Secret di GitHub.
    signingConfigs {
        create("bipoDev") {
            storeFile = file("bipo-dev.keystore")
            storePassword = "bipo-dev"
            keyAlias = "bipo"
            keyPassword = "bipo-dev"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("bipoDev")
        }
        release {
            signingConfig = signingConfigs.getByName("bipoDev")
        }
    }
}

flutter {
    source = "../.."
}
